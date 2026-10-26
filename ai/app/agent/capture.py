"""화상 답변 하나의 음성을 Soniox STT로 보내고, 답변 글·토큰·음성을 모은다.

기준: AI 명세 6.2(답변마다 듣기 시작한 시각이 tokens의 0ms,
answer.completed의 content·tokens·speech), 6.3 interview.stt(캡처마다 새 streamId),
6.5(STT 오류 뒤에도 인식된 글을 보존한다).
- 답변마다 새 캡처를 연다. Soniox 시각이 연결마다 0부터 시작하므로,
  듣기 시작한 시각(started_at)이 그 답변 tokens의 0ms가 된다.
- 말끝 흐림·억양 폭은 STT로 보낸 것과 같은 음성으로 답변이 끝날 때 한 번 계산한다
  (app.interview.realtime.voice).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from datetime import datetime

from livekit import rtc

from app.agent.stt import SAMPLE_RATE, SonioxSTT, SttSettings
from app.agent.transcript import TranscriptPublisher
from app.common.answer import SpeechToken, VoiceMetrics
from app.interview.realtime.voice import pcm16_samples, voice_metrics

log = logging.getLogger(__name__)
# 답변을 끝낸 뒤 Soniox가 남은 음성을 확정해 종료 응답을 줄 때까지 기다리는 상한(초)
FINISH_TIMEOUT = 15


async def audio_chunks(
    stream: AsyncIterator[rtc.AudioFrameEvent], closed: asyncio.Event
) -> AsyncGenerator[bytes]:
    stop = asyncio.create_task(closed.wait())
    frame: asyncio.Future[rtc.AudioFrameEvent] | None = None
    try:
        while not closed.is_set():
            frame = asyncio.ensure_future(anext(stream))
            done, _ = await asyncio.wait((frame, stop), return_when=asyncio.FIRST_COMPLETED)
            if stop in done:
                break
            try:
                yield bytes(frame.result().frame.data)
            except StopAsyncIteration:
                return
    finally:
        stop.cancel()
        if frame is not None:
            frame.cancel()
        await asyncio.gather(stop, *([frame] if frame is not None else []), return_exceptions=True)


class AnswerCapture:
    """답변 하나의 음성 캡처.

    on_speech는 발화(비공백 토큰의 끝 시각 최댓값이 늘어난 응답)를 받을 때마다,
    on_error는 답변을 듣는 중에 STT를 계속할 수 없게 되면 한 번 부른다.
    """

    def __init__(
        self,
        room: rtc.Room,
        participant: rtc.RemoteParticipant,
        settings: SttSettings,
        *,
        on_speech: Callable[[], None],
        on_error: Callable[[], None],
        clock: Callable[[], datetime],
        stt_factory: Callable[..., SonioxSTT] = SonioxSTT,
    ) -> None:
        # 음성 스트림을 먼저 열어, 열지 못하면 다른 작업을 시작하지 않는다
        self._stream = rtc.AudioStream.from_participant(
            participant=participant,
            track_source=rtc.TrackSource.SOURCE_MICROPHONE,
            sample_rate=SAMPLE_RATE,
            num_channels=1,
        )
        self._clock = clock
        # tokens의 0ms(answerStartedAt)는 Soniox로 보낸 첫 음성이다. 첫 프레임을 받을 때 다시 정한다
        # (재입장 직후처럼 마이크 구독이 늦으면 캡처를 연 시각과 차이가 나기 때문이다)
        self.started_at = clock()
        self._on_speech = on_speech
        self._on_error = on_error
        self._speech_end_ms: float | None = None
        self._pcm: list[bytes] = []
        self._closed = asyncio.Event()
        self._stream_closed = False
        self._finished = False
        self._publisher = TranscriptPublisher(room.local_participant, participant.identity)
        self._stt = stt_factory(settings, on_update=self._on_update)
        self._task = asyncio.create_task(self._run())

    def _on_update(self, confirmed: str, interim: str) -> None:
        self._publisher.update(confirmed, interim)
        end = self._stt.transcript.speech_end_ms
        if end is not None and (self._speech_end_ms is None or end > self._speech_end_ms):
            self._speech_end_ms = end
            self._on_speech()

    async def _collect(self) -> AsyncGenerator[bytes]:
        chunks = audio_chunks(self._stream, self._closed)
        try:
            async for chunk in chunks:
                if not self._pcm:
                    self.started_at = self._clock()
                self._pcm.append(chunk)
                yield chunk
        finally:
            await chunks.aclose()

    async def _run(self) -> None:
        try:
            await self._stt.run(self._collect())
        except asyncio.CancelledError:
            raise
        except Exception:
            # 공급자 오류 메시지에는 답변 원문이 들어 있을 수 있어 예외 내용을 남기지 않는다
            log.warning("답변 STT 실패")
            # 더 보낼 곳이 없는 음성이 쌓이지 않게 바로 닫는다
            await self._close_stream()
            # 답변을 끝내는 중(finish)의 오류는 이미 끝난 답변이라 알리지 않는다
            if not self._closed.is_set():
                self._publisher.fail()
                self._on_error()

    async def _close_stream(self) -> None:
        if not self._stream_closed:
            self._stream_closed = True
            await self._stream.aclose()

    async def finish(self) -> None:
        """음성 보내기를 끝내고 Soniox가 남은 음성을 확정할 때까지 기다린 뒤 정리한다."""
        self._closed.set()
        try:
            await asyncio.wait_for(asyncio.shield(self._task), timeout=FINISH_TIMEOUT)
        except TimeoutError:
            log.warning("답변 STT 종료 응답이 늦어 그때까지 확정된 글로 끝낸다")
        finally:
            await self._close()

    async def discard(self) -> None:
        """듣던 답변을 버린다(퇴장·면접방 종료). 이미 정리했으면 아무것도 하지 않는다."""
        self._closed.set()
        await self._close()

    async def _close(self) -> None:
        if self._finished:
            return
        # 정리 도중 취소돼도 남은 정리를 끝까지 한다. 끝난 뒤에만 정리했다고 표시한다
        try:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        finally:
            try:
                await self._close_stream()
            finally:
                await self._publisher.aclose()
                self._finished = True

    @property
    def content(self) -> str:
        return self._stt.transcript.content()

    def tokens(self) -> tuple[SpeechToken, ...] | None:
        return self._stt.transcript.answer_tokens()

    async def voice(self, tokens: tuple[SpeechToken, ...] | None) -> VoiceMetrics:
        """말끝 흐림 비율과 억양 폭. 계산은 CPU를 쓰므로 이벤트 루프 밖에서 한다.

        계산하지 못하면 두 값 모두 None이다(판정은 비어 있는 지표를 빼고 진행한다, AI 명세 3장).
        """
        try:
            samples = pcm16_samples(b"".join(self._pcm))
            return await asyncio.to_thread(voice_metrics, samples, SAMPLE_RATE, tokens)
        except Exception:
            log.exception("말하기 지표를 계산하지 못해 비워서 보낸다")
            return VoiceMetrics(trailing_off_ratio=None, pitch_range_st=None)
