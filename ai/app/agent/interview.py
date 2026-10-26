"""배정받은 면접의 질문을 차례로 진행한다: 질문을 말하고, 답변이 끝나면 다음 질문을 말한다.

기준: AI 명세 6.2 진행 흐름, 6.3 면접방 메시지(interview.answerState·interview.answerSubmit),
6.5 실패 처리, API 명세 면접방 메시지(화상 답변 끝 판단)
· 사용자 결정(2026-10-26: [답변 완료] 또는 마지막 말 뒤 7초 침묵이면 다음 질문으로 넘어간다.
명세대로 한마디도 안 했으면 넘어가지 않는다).
- 답변 끝 판단(7초·60초·[답변 완료] 거절)은 app.interview.realtime.answer_end에 맡기고,
  여기서는 시각을 넣고 타이머를 맞추고 결과대로 메시지를 보낸다.
- 화상은 답변마다 STT 캡처를 열어(app.agent.capture) 답변이 끝나면
  answer.completed를 결과 큐로 보낸다.
- 채팅은 화면이 5.7로 BE에 답변을 낸 뒤 [답변 완료](answer.submit)를 보내므로,
  듣지 않고 그것만 기다린다.
  질문 음성 재생 중에 와도 받아 두고, 질문을 다 말한 뒤 다음 질문으로 넘어간다.
- 화면이 answer.state를 받지 못해도(처리 함수 없음·응답 지연) 면접은 계속한다.
"""

from __future__ import annotations

import asyncio
import functools
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import replace
from datetime import datetime
from enum import StrEnum

from livekit import rtc

from app.agent.assignment import Assignment
from app.agent.capture import AnswerCapture
from app.agent.question import RPC_TIMEOUT, QuestionSpeaker
from app.agent.stt import SttSettings
from app.agent.tts import SpeechAudio
from app.common.results import KST, ResultPublisher, ResultPublishError
from app.common.session import MAX_SEQ, InterviewMode
from app.interview.realtime.answer_end import (
    INITIAL_STATE,
    AnswerEndEvent,
    AnswerEndState,
    AnswerStarted,
    Decision,
    Phase,
    SttError,
    SubmitRequested,
    Tick,
    next_answer_end,
    next_deadline,
)
from app.interview.realtime.answer_end import Speech as SpeechEvent
from app.interview.realtime.progress import (
    EndReason,
    ProgressMessage,
    ProgressMessageError,
    answer_completed,
)

log = logging.getLogger(__name__)
ANSWER_STATE_METHOD = "interview.answerState"
ANSWER_SUBMIT_METHOD = "interview.answerSubmit"
# AI 명세 6.3 RPC 오류
EMPTY_ANSWER = 2001
NOT_ANSWERING = 2002


class AnswerState(StrEnum):
    AUTO_SUBMITTED = "autoSubmitted"
    TIMED_OUT = "timedOut"
    STT_FAILED = "sttFailed"
    SUBMITTED = "submitted"
    SUBMIT_FAILED = "submitFailed"


def _now() -> datetime:
    return datetime.now(KST)


def _monotonic_ms() -> int:
    return int(time.monotonic() * 1000)


def answer_state_payload(session_id: int, seq: int, state: AnswerState) -> str:
    return json.dumps(
        {"type": "answer.state", "sessionId": session_id, "seq": seq, "state": state.value},
        separators=(",", ":"),
    )


def submitted_seq(payload: str) -> int | None:
    """answer.submit 본문의 질문 순서. 형식이 틀리면 None."""
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    seq = data.get("seq") if isinstance(data, dict) else None
    return seq if isinstance(seq, int) and not isinstance(seq, bool) else None


class AnswerEnd:
    """답변 하나의 끝을 기다린다. 이벤트를 판단 부품에 넣고, 그 결과대로 끝내거나 알린다."""

    def __init__(
        self,
        mode: InterviewMode,
        *,
        clock_ms: Callable[[], int] = _monotonic_ms,
        on_state: Callable[[AnswerState], None] = lambda _state: None,
    ) -> None:
        self._clock_ms = clock_ms
        self._on_state = on_state
        self._state = next_answer_end(INITIAL_STATE, AnswerStarted(clock_ms(), mode)).state
        self._changed = asyncio.Event()
        self._ended: asyncio.Future[EndReason] = asyncio.get_running_loop().create_future()

    @property
    def state(self) -> AnswerEndState:
        return self._state

    def _apply(self, event: AnswerEndEvent) -> Decision:
        step = next_answer_end(self._state, event)
        self._state = step.state
        self._changed.set()
        match step.decision:
            case Decision.SUBMIT:
                self._on_state(AnswerState.AUTO_SUBMITTED)
                self._end(EndReason.AUTO_SUBMIT)
            case Decision.ACCEPT:
                self._end(EndReason.MANUAL_SUBMIT)
            case Decision.TIMEOUT:
                self._on_state(AnswerState.TIMED_OUT)
                # 알린 뒤에도 같은 질문에서 계속 듣고, 말을 시작하면 7초 규칙으로 끝낸다
                # (API 명세 화상 답변 끝 판단). 60초는 다시 세지 않는다
                self._state = replace(self._state, phase=Phase.LISTENING, listen_started_at=None)
        return step.decision

    def _end(self, reason: EndReason) -> None:
        if not self._ended.done():
            self._ended.set_result(reason)

    def speech(self) -> None:
        self._apply(SpeechEvent(self._clock_ms()))

    def stt_failed(self) -> None:
        # 답변 중(듣는 중·재연결 중)일 때만 알린다. 이미 끝낸 답변의 STT 오류는 알릴 것이 없다
        if self._state.phase in (Phase.LISTENING, Phase.RECONNECTING):
            self._on_state(AnswerState.STT_FAILED)
        self._apply(SttError())

    def request_submit(self) -> Decision:
        return self._apply(SubmitRequested())

    def tick(self) -> None:
        """지금 시각으로 7초·60초가 지났는지 다시 판단한다."""
        self._apply(Tick(self._clock_ms()))

    async def wait(self) -> EndReason:
        """답변이 끝날 때까지 7초·60초 시각에 맞춰 판단을 다시 한다."""
        while not self._ended.done():
            self._changed.clear()
            deadline = next_deadline(self._state)
            timeout = None if deadline is None else max(0, deadline - self._clock_ms()) / 1000
            changed = asyncio.create_task(self._changed.wait())
            try:
                done, _ = await asyncio.wait(
                    (changed, self._ended), timeout=timeout, return_when=asyncio.FIRST_COMPLETED
                )
            finally:
                changed.cancel()
            if not done:
                self.tick()
        return self._ended.result()


class InterviewConductor:
    """질문 currentSeq부터 5번까지 진행한다. 5번 답변이 끝나면 더 말하지 않는다(AI 명세 6.2)."""

    def __init__(
        self,
        room: rtc.Room,
        assignment: Assignment,
        speaker: QuestionSpeaker,
        results: ResultPublisher | None,
        stt: SttSettings | None,
        wait_participant: Callable[[], Awaitable[rtc.RemoteParticipant | None]],
        *,
        clock: Callable[[], datetime] = _now,
        clock_ms: Callable[[], int] = _monotonic_ms,
        capture_factory: Callable[..., AnswerCapture] = AnswerCapture,
    ) -> None:
        self._room = room
        self._assignment = assignment
        self._speaker = speaker
        self._results = results
        self._stt = stt
        self._wait_participant = wait_participant
        self._clock = clock
        self._clock_ms = clock_ms
        self._capture_factory = capture_factory
        self._seq: int | None = None
        self._answer: AnswerEnd | None = None
        # 결과 큐에 넣지 못한 답변을 [다시 시도]로 다시 보내라는 신호(AI 명세 6.5)
        self._retry: asyncio.Event | None = None
        # 답변을 끝내고 결과 큐에 내는 중.
        # 이때 온 [답변 완료]는 이미 제출 중이라 받지 않는다(AI 명세 6.3)
        self._submitting = False
        self._destination: str | None = None
        self._left = asyncio.Event()
        self._prepared: dict[int, asyncio.Task[SpeechAudio | None]] = {}
        self._notices: set[asyncio.Task[None]] = set()

    @property
    def _video(self) -> bool:
        return self._assignment.mode is InterviewMode.VIDEO

    async def run(self) -> None:
        """5번 답변까지 진행한다.

        [답변 완료] 처리 함수는 aclose까지 남겨 지난 질문의 신호에도 false로 답한다(AI 명세 6.2).
        """
        self._room.on("participant_disconnected", self._on_left)
        self._room.local_participant.register_rpc_method(ANSWER_SUBMIT_METHOD, self._on_submit)
        try:
            await self._speaker.publish_track()
            for seq in range(self._assignment.current_seq, MAX_SEQ + 1):
                self._seq = seq
                self._prepare(seq)
                if seq < MAX_SEQ:
                    # 답변을 듣는 동안 다음 질문 음성을 미리 만들어 둔다
                    self._prepare(seq + 1)
                answer = self._answer_video if self._video else self._answer_chat
                answered = await answer(seq)
                if not answered:
                    # 면접방이 닫혀 더 진행할 수 없다
                    return
            log.info("마지막 질문까지 진행했다")
            # 마지막 답변의 submitted는 화면이 면접을 끝내는 신호이므로 보내던 알림을 끝까지 보낸다
            # (알림마다 RPC 응답 상한이 있어 오래 걸리지 않는다)
            await asyncio.gather(*self._notices, return_exceptions=True)
        finally:
            self._seq = None
            self._room.off("participant_disconnected", self._on_left)
            for task in (*self._prepared.values(), *self._notices):
                task.cancel()
            await asyncio.gather(*self._prepared.values(), *self._notices, return_exceptions=True)

    def aclose(self) -> None:
        """면접방이 닫힐 때 [답변 완료] 처리 함수를 내린다."""
        self._room.local_participant.unregister_rpc_method(ANSWER_SUBMIT_METHOD)

    def _prepare(self, seq: int) -> None:
        if seq not in self._prepared:
            self._prepared[seq] = asyncio.create_task(self._speaker.prepare(seq))

    def _on_left(self, participant: rtc.RemoteParticipant) -> None:
        if participant.identity == self._destination:
            self._left.set()

    async def _participant(self) -> rtc.RemoteParticipant | None:
        """지원자를 기다린다. 면접방이 닫히면 None.

        퇴장 신호는 기다리기 전에 지우고, 찾은 뒤 다시 실행되기 전에 퇴장했으면 다시 기다린다.
        """
        while True:
            self._left.clear()
            participant = await self._wait_participant()
            if participant is None:
                self._destination = None
                return None
            self._destination = participant.identity
            if participant.identity in self._room.remote_participants:
                return participant

    async def _until_left[T](self, work: Awaitable[T]) -> tuple[bool, T | None]:
        """work가 끝나거나 지원자가 퇴장할 때까지 기다린다.

        퇴장했으면 work를 멈추고 (True, None)을 돌려준다.
        """
        task = asyncio.ensure_future(work)
        left = asyncio.create_task(self._left.wait())
        try:
            await asyncio.wait((task, left), return_when=asyncio.FIRST_COMPLETED)
            if task.done():
                return False, task.result()
            return True, None
        finally:
            # 퇴장했거나 면접방이 닫혀 취소되면 하던 일(질문 음성·답변 대기)도 멈춘다
            for pending in (task, left):
                pending.cancel()
            await asyncio.gather(task, left, return_exceptions=True)

    async def _ask(self, seq: int) -> bool:
        """질문을 말한다. 면접방이 닫혀 지원자를 기다릴 수 없으면 False.

        말하는 중에 퇴장하면 재입장 뒤 다시 말하고 question.started는 다시 보내지 않는다.
        """
        announce = True
        while True:
            participant = await self._participant()
            if participant is None:
                return False
            audio = await self._prepared[seq]
            left, _ = await self._until_left(
                self._speaker.ask(seq, participant.identity, audio, announce=announce)
            )
            if not left:
                return True
            announce = False
            log.info("질문 음성 재생 중 지원자가 퇴장해 재입장 뒤 다시 말한다", extra={"seq": seq})

    async def _answer_chat(self, seq: int) -> bool:
        """질문을 말하고 [답변 완료]를 기다린다. 면접방이 닫혀 진행할 수 없으면 False."""
        # 채팅은 질문 음성 재생 중에 온 [답변 완료]도 받도록 질문 전에 답변을 시작한다
        answer = AnswerEnd(InterviewMode.CHAT, clock_ms=self._clock_ms)
        self._answer = answer
        try:
            if not await self._ask(seq):
                return False
            await answer.wait()
            return True
        finally:
            self._answer = None

    async def _answer_video(self, seq: int) -> bool:
        """질문을 말하고 답변을 들어 결과 큐에 낸다. 면접방이 닫혀 진행할 수 없으면 False.

        듣는 중에 퇴장하면 인식한 글을 버리고 재입장 뒤 처음부터 다시 듣는다.
        """
        assert self._stt is not None
        if not await self._ask(seq):
            return False
        while True:
            participant = await self._participant()
            if participant is None:
                return False
            destination = participant.identity
            answer = AnswerEnd(
                InterviewMode.VIDEO,
                clock_ms=self._clock_ms,
                on_state=functools.partial(self._notify, destination, seq),
            )
            try:
                capture = self._capture_factory(
                    self._room,
                    participant,
                    self._stt,
                    on_speech=answer.speech,
                    on_error=answer.stt_failed,
                    clock=self._clock,
                )
            except Exception:
                # 음성을 받을 수 없어 이 입장에서는 답변을 들을 수 없다. 재입장하면 다시 연다
                log.exception("답변 음성 캡처를 열지 못했다", extra={"seq": seq})
                self._notify(destination, seq, AnswerState.STT_FAILED)
                await self._left.wait()
                continue
            self._answer = answer
            try:
                left, reason = await self._until_left(answer.wait())
                if left or reason is None:
                    log.info("답변 중 퇴장해 재입장 뒤 처음부터 다시 듣는다", extra={"seq": seq})
                    continue
                self._submitting = True
                self._answer = None
                await capture.finish()
                message = await self._completed(seq, capture, reason)
            finally:
                self._answer = None
                # 끝낸 캡처는 정리돼 있고, 퇴장·취소로 빠져나온 캡처는 듣던 글을 버린다
                await capture.discard()
            try:
                if message is None:
                    # 발화가 있었는데 확정된 글이 없거나(STT가 확정 전에 끊김) 너무 길다.
                    # 낼 답변이 없으니 같은 질문을 새 캡처로 다시 듣는다.
                    # 화면은 새 자막 캡처를 보고 다시 답할 수 있다
                    continue
                await self._deliver(destination, seq, message)
                return True
            finally:
                self._submitting = False

    async def _completed(
        self, seq: int, capture: AnswerCapture, reason: EndReason
    ) -> ProgressMessage | None:
        tokens = capture.tokens()
        try:
            return answer_completed(
                self._assignment.session_id,
                seq,
                capture.started_at,
                capture.content,
                tokens,
                await capture.voice(tokens),
                reason,
            )
        except ProgressMessageError as e:
            log.warning("답변을 낼 수 없어 다시 듣는다: %s", e, extra={"seq": seq})
            return None

    async def _deliver(self, destination: str, seq: int, message: ProgressMessage) -> None:
        """결과 큐에 낸다.

        재시도 후에도 실패하면 submitFailed를 알리고 [다시 시도]를 기다린다(AI 명세 6.5).
        """
        while True:
            try:
                if self._results is not None:
                    # 결과 큐 전송기는 동기 Redis 클라이언트이고 재시도 중 대기하므로
                    # 별도 스레드에서 실행한다
                    await asyncio.to_thread(message.publish, self._results)
            except ResultPublishError:
                log.error("answer.completed 전송 실패", extra={"seq": seq})
                self._retry = asyncio.Event()
                try:
                    while True:
                        self._notify(destination, seq, AnswerState.SUBMIT_FAILED)
                        left, _ = await self._until_left(self._retry.wait())
                        if not left:
                            break
                        # 새로고침 등으로 재입장하면 실패를 다시 알려
                        # [다시 시도]를 받을 수 있게 한다
                        participant = await self._participant()
                        if participant is None:
                            return
                        destination = participant.identity
                finally:
                    self._retry = None
                continue
            self._notify(destination, seq, AnswerState.SUBMITTED)
            return

    async def _on_submit(self, data: rtc.RpcInvocationData) -> str:
        seq = submitted_seq(data.payload)
        # 이미 진행한 질문(새로고침 뒤 다시 낸 채팅 답변 등)의 [답변 완료]는 무시한다(AI 명세 6.2)
        if seq is None or seq != self._seq:
            return json.dumps({"accepted": False})
        if self._retry is not None:
            self._retry.set()
            return json.dumps({"accepted": True})
        if self._submitting:
            return json.dumps({"accepted": False})
        if self._answer is None:
            raise rtc.RpcError(NOT_ANSWERING, "NOT_ANSWERING")
        decision = self._answer.request_submit()
        if decision is Decision.EMPTY_ANSWER:
            raise rtc.RpcError(EMPTY_ANSWER, "EMPTY_ANSWER")
        if decision is Decision.NOT_ANSWERING:
            raise rtc.RpcError(NOT_ANSWERING, "NOT_ANSWERING")
        return json.dumps({"accepted": decision is Decision.ACCEPT})

    def _notify(self, destination: str, seq: int, state: AnswerState) -> None:
        """answer.state를 보낸다. 화면 응답을 기다리느라 면접이 멈추지 않게 따로 보낸다."""
        task = asyncio.create_task(self._send_state(destination, seq, state))
        self._notices.add(task)
        task.add_done_callback(self._notices.discard)

    async def _send_state(self, destination: str, seq: int, state: AnswerState) -> None:
        try:
            await asyncio.wait_for(
                self._room.local_participant.perform_rpc(
                    destination_identity=destination,
                    method=ANSWER_STATE_METHOD,
                    payload=answer_state_payload(self._assignment.session_id, seq, state),
                    response_timeout=RPC_TIMEOUT,
                ),
                timeout=RPC_TIMEOUT,
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            code = e.code if isinstance(e, rtc.RpcError) else type(e).__name__
            log.warning(
                "answer.state 알림 실패", extra={"seq": seq, "state": state.value, "code": code}
            )
