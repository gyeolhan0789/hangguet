"""질문을 면접관 음성으로 말하고, 시작·끝을 BE와 지원자 화면에 알린다.

기준: AI 명세 6.2 질문 단계, 6.3 interview.question, 6.5 TTS 실패.
- 질문 음성은 에이전트가 올린 마이크 트랙 하나로 내보낸다.
  녹화 파일 이름이 참가자 이름(interviewer)과 트랙 종류로 정해지므로(AI 명세 7장)
  트랙은 하나만 올린다.
- BE에는 question.started(seq·startedAt·출제한 질문의 글·채점 기준·생성 버전)를 결과 큐로 전송한다.
  startedAt은 질문 음성의 첫 소리를 송출하는 시각이고,
  음성이 없으면 failed를 전송하기 직전 시각이다(AI 명세 6.2).
  화면 알림이 최대 3초를 기다리므로,
  알림 전에 기록하면 다시보기 마커가 실제 음성보다 앞에 찍히기 때문이다.
  BE가 이 메시지로 질문 행을 생성해야 화면의 지금 질문(5.5)이 이 질문을 반환한다.
  꼬리질문은 플랜에 없으므로 질문 글은 배정 정보가 아니라 출제한 질문에서 읽는다(AI 명세 6.2).
- 화면에는 interview.question RPC로 started(글자별 발음 시각 포함) → ended를 보낸다.
  합성하지 못하면 failed를 보내고, 화면은 질문 글로 진행한다.
- 화면이 RPC를 받지 못해도(처리 함수 미등록·응답 지연) 질문 음성은 계속 내보낸다.
  알림 실패로 면접이 멈추지 않게 하기 위함이다.
- 발화 중단 안내(AI 명세 6.3 interrupt.text)도 같은 트랙으로 말한다.
  안내 글은 리액션 메시지로 화면에 전달되므로 question 알림과 question.started는 보내지 않는다.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Callable
from datetime import datetime
from enum import StrEnum
from typing import Any

from livekit import rtc

from app.agent.assignment import AssignedQuestion, Assignment
from app.agent.tts import BYTES_PER_SAMPLE, SAMPLE_RATE, ElevenLabsTTS, SpeechAudio, TtsError
from app.common.results import KST, ResultPublisher, ResultPublishError
from app.common.timing import elapsed_ms
from app.interview.realtime.progress import question_started

log = logging.getLogger(__name__)
QUESTION_METHOD = "interview.question"
# AI 명세 6.3: RPC 본문은 15KiB 이하
MAX_RPC_PAYLOAD_BYTES = 15 * 1024
# 화면이 응답하지 않아도 질문 음성이 늦어지지 않도록 기다리는 상한(초)
RPC_TIMEOUT = 3.0
FRAME_MS = 10
TRACK_NAME = "interviewer-voice"


class SpeechState(StrEnum):
    STARTED = "started"
    ENDED = "ended"
    FAILED = "failed"


def _now() -> datetime:
    return datetime.now(KST)


def question_payload(
    session_id: int,
    seq: int,
    content: str,
    speech: SpeechState,
    audio: SpeechAudio | None = None,
) -> str:
    """interview.question 본문. alignment는 started에만 담고 나머지는 null이다.

    키를 항상 모두 담아 화면이 키가 있는지 분기하지 않게 한다(AI 명세 6.3 reaction과 같은 방식).
    글자별 시각을 담아 15KiB를 넘으면 시각을 빼고 보낸다.
    나눠 보내는 방법은 명세에서 정하지 않았고(6.3 [미정]),
    시각이 없어도 화면은 질문 글로 진행할 수 있다.
    """
    message: dict[str, Any] = {
        "type": "question",
        "sessionId": session_id,
        "seq": seq,
        "content": content,
        "speech": speech.value,
        "alignment": None,
    }
    if speech is SpeechState.STARTED and audio is not None:
        message["alignment"] = {"chars": [char.to_json() for char in audio.chars]}
    payload = _dumps(message)
    if len(payload.encode()) > MAX_RPC_PAYLOAD_BYTES and message["alignment"] is not None:
        log.warning("질문 발음 시각이 RPC 크기 상한을 넘어 빼고 보낸다", extra={"seq": seq})
        message["alignment"] = None
        payload = _dumps(message)
    return payload


def _dumps(message: dict[str, Any]) -> str:
    return json.dumps(message, ensure_ascii=False, separators=(",", ":"))


def audio_frames(pcm: bytes) -> list[rtc.AudioFrame]:
    """24kHz·모노 PCM을 10ms 프레임으로 나눈다. 마지막 프레임은 무음으로 채운다."""
    samples = SAMPLE_RATE * FRAME_MS // 1000
    size = samples * BYTES_PER_SAMPLE
    frames = []
    for offset in range(0, len(pcm), size):
        chunk = pcm[offset : offset + size]
        frames.append(rtc.AudioFrame(chunk.ljust(size, b"\0"), SAMPLE_RATE, 1, samples))
    return frames


class QuestionSpeaker:
    def __init__(
        self,
        participant: rtc.LocalParticipant,
        assignment: Assignment,
        tts: ElevenLabsTTS,
        results: ResultPublisher | None,
        *,
        clock: Callable[[], datetime] = _now,
        timer: Callable[[], float] = time.monotonic,
    ) -> None:
        self._participant = participant
        self._assignment = assignment
        self._tts = tts
        self._results = results
        self._clock = clock
        self._timer = timer
        self._source: rtc.AudioSource | None = None
        # question.started를 전송한 질문 순서. 같은 질문을 다시 말해도 한 번만 전송한다
        self._announced: set[int] = set()

    async def publish_track(self) -> None:
        source = rtc.AudioSource(SAMPLE_RATE, 1)
        track = rtc.LocalAudioTrack.create_audio_track(TRACK_NAME, source)
        await self._participant.publish_track(
            track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        )
        self._source = source

    async def prepare(self, seq: int, question: AssignedQuestion) -> SpeechAudio | None:
        """질문 음성을 미리 합성한다. 실패하면 None이고, ask가 failed로 알린다."""
        text = question.content
        started = self._timer()
        try:
            audio = await self._tts.synthesize(text, self._assignment.persona)
        except TtsError as e:
            ms = elapsed_ms(started, self._timer())
            log.warning("질문 음성 합성 실패: %s ms=%d", e, ms, extra={"seq": seq})
            return None
        ms = elapsed_ms(started, self._timer())
        log.info("질문 음성 합성 완료 ms=%d chars=%d", ms, len(text), extra={"seq": seq})
        return audio

    async def prepare_notice(self, text: str) -> SpeechAudio | None:
        """발화 중단 안내 음성을 미리 합성한다.

        실패하면 None이고, 화면은 리액션 메시지의 안내 글로 진행한다.
        """
        started = self._timer()
        try:
            audio = await self._tts.synthesize(text, self._assignment.persona)
        except TtsError as e:
            log.warning(
                "발화 중단 안내 음성 합성 실패: %s ms=%d", e, elapsed_ms(started, self._timer())
            )
            return None
        ms = elapsed_ms(started, self._timer())
        log.info("발화 중단 안내 음성 합성 완료 ms=%d chars=%d", ms, len(text))
        return audio

    async def say(self, audio: SpeechAudio) -> None:
        """발화 중단 안내 음성을 재생한다.

        취소하면 남은 음성을 버린다.
        """
        if self._source is not None:
            await self._play(audio)

    async def ask(
        self,
        seq: int,
        question: AssignedQuestion,
        destination: str,
        audio: SpeechAudio | None,
    ) -> None:
        """질문을 말한다.

        question.started는 그 질문의 음성 송출을 처음 시작할 때,
        음성이 없으면 failed를 처음 전송할 때 한 번만 전송한다.
        재입장 뒤 같은 질문을 다시 말할 때 이미 전송했으면 다시 전송하지 않는다.
        BE가 질문 행을 처음 시작 시각으로 이미 저장했기 때문이다(AI 명세 6.5).
        음성을 송출하기 전에 퇴장했으면 아직 전송하지 않았으므로 다시 말할 때 전송한다.
        """
        content = question.content
        started: asyncio.Task[None] | None = None

        def mark_started() -> None:
            nonlocal started
            if seq in self._announced:
                return
            self._announced.add(seq)
            started = asyncio.create_task(self._publish_started(seq, question, self._clock()))

        try:
            if audio is None or self._source is None:
                # 화면 응답을 기다린 뒤 기록하면 최대 3초 늦어지므로 failed를 전송하기 전에 기록한다
                mark_started()
                await self._notify(destination, seq, content, SpeechState.FAILED)
                return
            await self._notify(destination, seq, content, SpeechState.STARTED, audio)
            try:
                await self._play(audio, on_start=mark_started)
            except Exception:
                log.exception("질문 음성 송출 실패", extra={"seq": seq})
                await self._notify(destination, seq, content, SpeechState.FAILED)
                return
            await self._notify(destination, seq, content, SpeechState.ENDED)
        finally:
            if started is not None:
                await started

    async def aclose(self) -> None:
        if self._source is not None:
            self._source.clear_queue()
            await self._source.aclose()
            self._source = None

    async def _play(
        self, audio: SpeechAudio, *, on_start: Callable[[], None] | None = None
    ) -> None:
        assert self._source is not None
        source = self._source
        try:
            if on_start is not None:
                on_start()
            for frame in audio_frames(audio.pcm):
                await source.capture_frame(frame)
            await source.wait_for_playout()
        except asyncio.CancelledError:
            # 면접방이 닫히거나 안내를 멈추면 남은 음성을 버린다
            source.clear_queue()
            raise

    async def _publish_started(
        self, seq: int, question: AssignedQuestion, started_at: datetime
    ) -> None:
        if self._results is None:
            return
        try:
            # 결과 큐 전송기는 동기 Redis 클라이언트이고 재시도 중 대기하므로
            # 별도 스레드에서 실행한다
            message = question_started(
                self._assignment.session_id,
                seq,
                started_at,
                question.content,
                question.criteria,
                prompt_version=question.prompt_version,
                model_version=question.model_version,
            )
            await asyncio.to_thread(message.publish, self._results)
        except ResultPublishError:
            log.error("question.started 전송 실패", extra={"seq": seq})

    async def _notify(
        self,
        destination: str,
        seq: int,
        content: str,
        speech: SpeechState,
        audio: SpeechAudio | None = None,
    ) -> None:
        payload = question_payload(self._assignment.session_id, seq, content, speech, audio)
        try:
            await asyncio.wait_for(
                self._participant.perform_rpc(
                    destination_identity=destination,
                    method=QUESTION_METHOD,
                    payload=payload,
                    response_timeout=RPC_TIMEOUT,
                ),
                timeout=RPC_TIMEOUT,
            )
        except (rtc.RpcError, TimeoutError) as e:
            code = e.code if isinstance(e, rtc.RpcError) else "timeout"
            log.info("질문 상태 화면 전달 실패 speech=%s code=%s", speech.value, code)
