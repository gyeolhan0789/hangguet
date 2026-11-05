"""질문을 면접관 음성으로 말하고, 시작·끝을 BE와 지원자 화면에 알린다.

기준: AI 명세 6.2 질문 단계, 6.3 interview.question,
6.5 TTS 실패·면접관 음성 송출 실패·재생 멈춤·질문 시작 전송 실패.
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
- question.started 전송이 재시도 후에도 실패해도 질문은 그대로 진행한다(AI 명세 6.5).
  질문 행이 없으면 BE가 그 질문의 답변을 저장하지 못하므로,
  같은 메시지를 보관하고 전송에 성공하거나 면접이 끝날 때까지 일정 간격으로 다시 전송한다.
  답변 전달은 ensure_started로 전송 여부를 확인한 뒤 answer.completed를 전송한다.
- 화면에는 interview.question RPC로 started(글자별 발음 시각 포함) → ended를 보낸다.
  합성하지 못하면 failed를 보내고, 화면은 질문 글로 진행한다.
- 화면이 RPC를 받지 못해도(처리 함수 미등록·응답 지연) 질문 음성은 계속 내보낸다.
  알림 실패로 면접이 멈추지 않게 하기 위함이다.
- 송출이 막히면 재생이 끝나지 않아 면접이 그 자리에서 멈추므로,
  송출에 실패하거나 음성 길이에 여유(PLAYOUT_MARGIN_SECONDS)를 더한 시간 안에
  재생이 끝나지 않으면 남은 음성을 폐기한다.
  질문이면 failed를 전송하고 답변 듣기로 진행한다(AI 명세 6.5).
- 발화 중단 안내(AI 명세 6.3 interrupt.text)와 칭찬(AI 명세 6.2 호응)도 같은 트랙으로 말한다.
  안내 글은 리액션 메시지로 화면에 전달되므로 question 알림과 question.started는 보내지 않는다.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import datetime
from enum import StrEnum
from typing import Any

from livekit import rtc

from app.agent.assignment import AssignedQuestion, Assignment
from app.agent.tts import BYTES_PER_SAMPLE, SAMPLE_RATE, ElevenLabsTTS, SpeechAudio, TtsError
from app.common.results import KST, ResultPublisher, ResultPublishError
from app.common.timing import elapsed_ms
from app.interview.realtime.progress import ProgressMessage, question_started

log = logging.getLogger(__name__)
QUESTION_METHOD = "interview.question"
# AI 명세 6.3: RPC 본문은 15KiB 이하
MAX_RPC_PAYLOAD_BYTES = 15 * 1024
# 화면이 응답하지 않아도 질문 음성이 늦어지지 않도록 기다리는 상한(초)
RPC_TIMEOUT = 3.0
# AI 명세 6.5: 재시도 후에도 전송하지 못한 question.started를 다시 전송하는 간격(초)
STARTED_RETRY_SECONDS = 4.0
# 질문 음성을 이 길이씩 내보낸다. 10ms씩이면 조각마다 SDK와 파이썬을 오가는 비용으로
# CPU를 더 쓴다(loadtest/report/agent-audio-2026-11-04.md).
# 마지막 조각은 무음으로 채우므로 끝이 최대 이만큼 늦는다
FRAME_MS = 100
TRACK_NAME = "interviewer-voice"
# AI 명세 6.5: 재생이 음성 길이보다 이만큼(초, 임시 값) 더 걸리면 송출이 멈춘 것으로 간주한다
PLAYOUT_MARGIN_SECONDS = 10.0


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
    """24kHz·모노 PCM을 FRAME_MS 프레임으로 나눈다. 마지막 프레임은 무음으로 채운다."""
    samples = SAMPLE_RATE * FRAME_MS // 1000
    size = samples * BYTES_PER_SAMPLE
    frames = []
    for offset in range(0, len(pcm), size):
        chunk = pcm[offset : offset + size]
        frames.append(rtc.AudioFrame(chunk.ljust(size, b"\0"), SAMPLE_RATE, 1, samples))
    return frames


def playout_limit_ms(audio: SpeechAudio) -> int:
    """음성 재생을 기다리는 상한(밀리초). 음성 길이에 PLAYOUT_MARGIN_SECONDS를 더한다."""
    return audio.duration_ms + round(PLAYOUT_MARGIN_SECONDS * 1000)


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
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._participant = participant
        self._assignment = assignment
        self._tts = tts
        self._results = results
        self._clock = clock
        self._timer = timer
        self._sleep = sleep
        self._source: rtc.AudioSource | None = None
        # 기록한 question.started. 같은 질문을 다시 말해도 처음 기록한 메시지만 전송한다
        self._started: dict[int, ProgressMessage] = {}
        # 결과 큐에 추가한 질문 순서
        self._sent: set[int] = set()
        self._resending: dict[int, asyncio.Task[None]] = {}
        # 다시 전송과 답변 전달 전 확인이 같은 메시지를 동시에 전송하지 않게 한다
        self._sending = asyncio.Lock()

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
        """발화 중단 안내·칭찬 음성을 재생한다.

        송출에 실패하거나 재생 상한을 넘기면 남은 음성을 폐기하고 반환한다.
        취소하면 남은 음성을 폐기하고 취소를 전파한다.
        """
        if self._source is None:
            return
        try:
            await self._play(audio)
        except TimeoutError:
            log.warning("안내·칭찬 음성 재생 상한 초과 limit_ms=%d", playout_limit_ms(audio))
        except Exception:
            log.exception("안내·칭찬 음성 송출 실패")

    async def ask(
        self,
        seq: int,
        question: AssignedQuestion,
        destination: str,
        audio: SpeechAudio | None,
    ) -> None:
        """질문을 말한다.

        question.started는 그 질문의 음성 송출을 처음 시작할 때,
        음성이 없으면 failed를 처음 전송할 때 시각을 기록해 전송한다.
        전송을 기다리지 않고 질문을 진행하며,
        실패하면 면접이 끝날 때까지 다시 전송한다(AI 명세 6.5).
        재입장 뒤 같은 질문을 다시 말할 때 이미 기록했으면 다시 기록하지 않는다.
        BE가 질문 행을 처음 시작 시각으로 저장하기 때문이다(AI 명세 6.5).
        음성을 송출하기 전에 퇴장했으면 아직 기록하지 않았으므로 다시 말할 때 기록한다.
        """
        content = question.content

        def mark_started() -> None:
            if seq not in self._started:
                self._start_sending(seq, question, self._clock())

        if audio is None or self._source is None:
            # 화면 응답을 기다린 뒤 기록하면 최대 3초 늦어지므로 failed를 전송하기 전에 기록한다
            mark_started()
            await self._notify(destination, seq, content, SpeechState.FAILED)
            return
        await self._notify(destination, seq, content, SpeechState.STARTED, audio)
        try:
            await self._play(audio, on_start=mark_started)
        except TimeoutError:
            log.warning(
                "질문 음성 재생 상한 초과 limit_ms=%d", playout_limit_ms(audio), extra={"seq": seq}
            )
            await self._notify(destination, seq, content, SpeechState.FAILED)
            return
        except Exception:
            log.exception("질문 음성 송출 실패", extra={"seq": seq})
            await self._notify(destination, seq, content, SpeechState.FAILED)
            return
        await self._notify(destination, seq, content, SpeechState.ENDED)

    async def ensure_started(self, seq: int) -> bool:
        """그 질문의 question.started가 결과 큐에 추가되었는지 확인한다.

        아직이고 다시 전송 중이 아니면 한 번 더 전송하며, 결과 큐에 추가되었으면 True다.
        답변 전달은 True일 때만 answer.completed를 전송한다.
        질문 행이 없으면 BE가 답변을 저장하지 못하기 때문이다(AI 명세 6.5).
        기록한 적이 없는 질문은 전송할 메시지가 없으므로 True다.
        """
        if seq in self._sent or seq not in self._started:
            return True
        if self._sending.locked():
            # 다시 전송 중이면 그 결과만 확인하고 새로 전송하지 않는다.
            # Redis 응답이 끊긴 장애에서
            # submitFailed 안내가 전송 두 번만큼 늦어지지 않게 하기 위함이다
            async with self._sending:
                return seq in self._sent
        async with self._sending:
            return await self._send(seq)

    async def aclose(self) -> None:
        """면접이 끝나면 question.started 다시 전송을 멈추고 음성 트랙을 닫는다."""
        for task in self._resending.values():
            task.cancel()
        await asyncio.gather(*self._resending.values(), return_exceptions=True)
        self._resending.clear()
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
            # 대기열이 가득 차 프레임을 전송하는 단계에서도 멈출 수 있으므로,
            # 재생 완료 대기와 함께 제한한다
            async with asyncio.timeout(playout_limit_ms(audio) / 1000):
                for frame in audio_frames(audio.pcm):
                    await source.capture_frame(frame)
                await source.wait_for_playout()
        except (asyncio.CancelledError, Exception):
            # 면접방이 닫히거나, 안내를 멈추거나, 송출이 실패·멈추면 남은 음성을 폐기한다
            source.clear_queue()
            raise

    def _start_sending(self, seq: int, question: AssignedQuestion, started_at: datetime) -> None:
        self._started[seq] = question_started(
            self._assignment.session_id,
            seq,
            started_at,
            question.content,
            question.criteria,
            prompt_version=question.prompt_version,
            model_version=question.model_version,
        )
        self._resending[seq] = asyncio.create_task(self._send_until_sent(seq))

    async def _send_until_sent(self, seq: int) -> None:
        while True:
            async with self._sending:
                if await self._send(seq):
                    return
            await self._sleep(STARTED_RETRY_SECONDS)

    async def _send(self, seq: int) -> bool:
        """question.started를 전송한다. 결과 큐에 추가했거나 이미 추가되어 있으면 True다."""
        if seq in self._sent:
            return True
        if self._results is not None:
            try:
                # 결과 큐 전송기는 동기 Redis 클라이언트이고 재시도 중 대기하므로
                # 별도 스레드에서 실행한다
                await asyncio.to_thread(self._started[seq].publish, self._results)
            except ResultPublishError:
                log.error("question.started 전송 실패", extra={"seq": seq})
                return False
        self._sent.add(seq)
        return True

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
