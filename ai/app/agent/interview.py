"""면접에서 질문 → 답변 → 답변 끝 → 다음 질문을 마지막 질문까지 진행한다.

기준: AI 명세 6.2 진행 흐름, 6.3 면접방 메시지, 6.5 실패 처리,
API 명세 면접방 메시지의 화상 답변 끝 판단.
- 채팅 답변은 화면이 답변 제출 API(5.7)로 BE에 저장한 뒤 [답변 완료]를 전송하므로,
  음성을 듣지 않고 [답변 완료]만 기다린다.
  이미 진행한 질문의 [답변 완료]는 받지 않는다(accepted false).
  화면이 새로고침 뒤 다시 제출해 5.7이 409를 반환해도 [답변 완료]를 전송하기 때문이다.
  채팅은 퇴장해도 폐기할 답변이 없으므로 같은 답변을 계속 기다린다.
- 답변 끝(7초 자동 제출, 60초 무응답, [답변 완료])은
  app.interview.realtime.answer_end의 결정을 따른다.
  타이머는 next_deadline이 반환한 시각에만 설정한다.
- 질문 음성 재생 중의 [답변 완료]는 답변 중이 아니므로 2002로 거절한다.
  지금 질문이 아닌 seq의 [답변 완료]도 지금 답할 수 있는 질문이 아니므로 2002로 거절한다.
- 지원자가 퇴장하면 진행 중인 답변을 폐기하고 재입장을 기다린다.
  재입장하면 같은 질문의 답변을 처음부터 다시 듣는다.
  질문 음성 재생 중에 퇴장했으면 질문을 다시 말하고,
  BE에 전송하는 question.started는 다시 전송하지 않는다.
- 면접방이 닫히면 진행 중인 답변은 전달하지 않는다(AI 명세 6.1).
- 다음 질문 음성은 답변을 듣는 동안 미리 합성한다(AI 명세 6장 머리말).
- 답변 결과 전달은 on_answer가 담당한다.
  결과 큐 전송이 재시도 후에도 실패하면 submitFailed를 알리고 다음 질문으로 진행하지 않는다.
  [답변 완료]를 수신하면 보관한 같은 답변을 다시 전달한다(AI 명세 6.5).
  그동안 지원자가 재입장하면 화면이 실패 상태를 모르므로 submitFailed를 다시 알린다.
- 화상 답변은 문장이 끝날 때마다 리액션을 판단한다(AI 명세 6.2 3번).
  답변이 끝나거나 지원자가 퇴장하면 판단 중이던 리액션을 전송하지 않는다(AI 명세 6.5).
- 채팅은 chat.input을 수신할 때마다 리액션을 판단한다(AI 명세 6.2 3번).
  질문 음성 재생 중의 입력도 현재 질문의 입력이므로 질문을 말하기 시작할 때부터 수신한다.
  재입장한 화면은 이전 입력 seq를 모르므로 수신한 seq 기록을 초기화한다(AI 명세 6.5).
- 화상 발화 중단 안내는 면접 시작 때 미리 합성해 두고, 판단되면 답변 중에 재생한다.
  재생 중에는 7초를 중지하고(AI 명세 6.2 4번), 답변이 끝나거나 지원자가 퇴장하면 재생을 멈춘다.
  [답변 완료]는 재생 중에도 수락하며, 답변이 끝나므로 재생을 멈추고 제출한다(AI 명세 6.3).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from typing import Any, Protocol

from app.agent.answer_capture import CapturedAnswer
from app.agent.answer_rpc import (
    AnswerState,
    answer_state_payload,
    answer_submit_reply,
    parse_answer_submit,
)
from app.agent.assignment import Assignment
from app.agent.reaction import ReactionStream, chat_input_reply, parse_chat_input
from app.agent.tts import SpeechAudio
from app.common.answer import SpeechToken
from app.common.results import ResultPublishError
from app.common.session import MAX_SEQ, InterviewMode
from app.interview.realtime.answer_end import (
    INITIAL_STATE,
    AnswerEndEvent,
    AnswerStarted,
    Decision,
    NoticeEnded,
    NoticeStarted,
    Phase,
    Speech,
    SttError,
    SubmitFailed,
    SubmitRequested,
    Tick,
    next_answer_end,
    next_deadline,
)
from app.interview.realtime.interrupt import INTERRUPT_PHRASES, Interrupt, InterruptReason
from app.interview.realtime.progress import EndReason
from app.interview.realtime.sentence import Sentence

log = logging.getLogger(__name__)


class QuestionAsker(Protocol):
    async def prepare(self, seq: int) -> SpeechAudio | None: ...

    async def prepare_notice(self, text: str) -> SpeechAudio | None: ...

    async def say(self, audio: SpeechAudio) -> None: ...

    async def ask(
        self, seq: int, destination: str, audio: SpeechAudio | None, *, announce: bool = True
    ) -> None: ...


class CaptureSession(Protocol):
    """답변 하나의 음성 수집이다.

    면접방 연결은 호출 측이 구현한다.
    """

    async def run(self) -> CapturedAnswer: ...

    def stop(self) -> None: ...

    def snapshot(self) -> CapturedAnswer: ...

    def answer_tokens(self) -> tuple[SpeechToken, ...] | None: ...

    def fail(self) -> None: ...

    async def aclose(self) -> None: ...


CaptureOpener = Callable[[str, Callable[[], None], Callable[[Sentence, str], None]], CaptureSession]
StateSender = Callable[[str, str], Coroutine[Any, Any, None]]


@dataclass(frozen=True)
class FinishedAnswer:
    seq: int
    answer: CapturedAnswer
    end_reason: EndReason


def _monotonic_ms() -> int:
    return int(time.monotonic() * 1000)


class InterviewRunner:
    def __init__(
        self,
        assignment: Assignment,
        asker: QuestionAsker,
        open_capture: CaptureOpener,
        send_state: StateSender,
        *,
        on_answer: Callable[[FinishedAnswer], Awaitable[bool]] | None = None,
        reactions: ReactionStream | None = None,
        monotonic_ms: Callable[[], int] = _monotonic_ms,
    ) -> None:
        self._assignment = assignment
        self._chat = assignment.mode is InterviewMode.CHAT
        self._asker = asker
        self._open_capture = open_capture
        self._send_state = send_state
        self._on_answer = on_answer
        self._reactions = reactions
        if reactions is not None:
            reactions.on_interrupt = self._interrupted
        self._notices: dict[InterruptReason, asyncio.Task[SpeechAudio | None]] = {}
        self._notice: asyncio.Task[None] | None = None
        # 현재 질문에서 수신한 마지막 채팅 입력 seq
        self._chat_input_seq = 0
        self._ms = monotonic_ms
        # 현재 듣고 있는 답변의 음성 수집.
        # 발화가 갱신될 때 긴 답변을 판단하기 위함이다
        self._capture: CaptureSession | None = None
        self._state = INITIAL_STATE
        self._seq: int | None = None
        self._candidate: str | None = None
        self._present = asyncio.Event()
        self._left = asyncio.Event()
        self._wake = asyncio.Event()
        self._finish: EndReason | None = None
        self._prepared: dict[int, asyncio.Task[SpeechAudio | None]] = {}
        self._notifications: set[asyncio.Task[None]] = set()

    def candidate_joined(self, identity: str) -> None:
        # 퇴장 표시는 진행 중인 질문·답변이 확인한 뒤 지운다.
        # 퇴장 직후 바로 재입장해도 이전 답변을 폐기하기 위함이다
        self._candidate = identity
        self._present.set()
        self._chat_input_seq = 0
        if self._state.phase is Phase.SUBMIT_FAILED and self._seq is not None:
            self._notify(identity, self._seq, AnswerState.SUBMIT_FAILED)

    def candidate_left(self, identity: str) -> None:
        if identity != self._candidate:
            return
        self._present.clear()
        self._left.set()
        self._wake.set()

    def submit_requested(self, payload: str) -> str:
        """[답변 완료] 처리 함수다.

        거절은 RPC 오류로 발생시킨다.
        """
        seq = parse_answer_submit(payload, self._assignment.session_id)
        if seq == self._seq:
            decision = self._apply(SubmitRequested())
        elif self._chat and self._seq is not None and seq < self._seq:
            decision = Decision.ALREADY_SUBMITTING
        else:
            # 지금 답할 수 있는 질문이 아니므로 답변 중 아님(2002)이다
            decision = Decision.NOT_ANSWERING
        if decision is Decision.ACCEPT:
            self._finish = EndReason.MANUAL_SUBMIT
            self._wake.set()
        return answer_submit_reply(decision)

    def chat_input_received(self, payload: str) -> str:
        """채팅 입력(chat.input) 처리 함수다.

        현재 질문이 아니거나 이미 수신한 seq 이하이면 판단하지 않고 false로 응답한다(AI 명세 6.3).
        """
        message = parse_chat_input(payload, self._assignment.session_id)
        reactions = self._reactions
        accepted = (
            self._chat
            and reactions is not None
            and reactions.listening
            and message.question_seq == self._seq
            and message.seq > self._chat_input_seq
        )
        if accepted:
            assert reactions is not None
            self._chat_input_seq = message.seq
            # 채팅은 입력 칸 전체를 전송하므로 그 글이 지금까지의 답변이다
            reactions.submit(message.text, message.pause_ms, message.text)
        return chat_input_reply(accepted)

    async def run(self) -> None:
        self._prepare_notices()
        try:
            for seq in range(self._assignment.current_seq, MAX_SEQ + 1):
                await self._question(seq)
            # 마지막 답변의 submitted도 화면에 전달되도록 남은 알림을 기다린다.
            # 알림은 화면 응답 상한 뒤 끝나므로 오래 걸리지 않는다
            await asyncio.gather(*self._notifications, return_exceptions=True)
            log.info("마지막 질문까지 진행했다", extra={"session": self._assignment.session_id})
        finally:
            pending = [*self._prepared.values(), *self._notifications, *self._notices.values()]
            if self._notice is not None:
                pending.append(self._notice)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

    async def _question(self, seq: int) -> None:
        self._seq = seq
        self._chat_input_seq = 0
        self._prepare(seq)
        self._prepare(seq + 1)
        announce = True
        while True:
            destination = await self._wait_candidate()
            if self._chat and self._reactions is not None:
                self._reactions.start(seq, destination)
            # 질문 음성 재생 중에는 답변 중이 아니므로 [답변 완료]를 거절한다
            self._state = INITIAL_STATE
            if await self._speak(seq, destination, announce):
                break
            announce = False
        while not await self._answer(seq):
            await self._wait_candidate()
        self._prepared.pop(seq, None)

    def _prepare(self, seq: int) -> None:
        if seq <= MAX_SEQ and seq not in self._prepared:
            self._prepared[seq] = asyncio.create_task(self._asker.prepare(seq))

    async def _wait_candidate(self) -> str:
        await self._present.wait()
        self._left.clear()
        assert self._candidate is not None
        return self._candidate

    async def _speak(self, seq: int, destination: str, announce: bool) -> bool:
        """질문을 말한다.

        말하는 도중 지원자가 퇴장하면 False다.
        """
        audio = await self._prepared[seq]
        asking = asyncio.create_task(self._asker.ask(seq, destination, audio, announce=announce))
        left = asyncio.create_task(self._left.wait())
        try:
            done, _ = await asyncio.wait((asking, left), return_when=asyncio.FIRST_COMPLETED)
            if asking in done:
                asking.result()
                return True
            return False
        finally:
            for task in (asking, left):
                task.cancel()
            await asyncio.gather(asking, left, return_exceptions=True)

    async def _answer(self, seq: int) -> bool:
        """답변 하나를 듣는다.

        지원자가 퇴장해 답변을 폐기했으면 False다.
        """
        if self._chat:
            await self._chat_answer()
            if self._reactions is not None:
                await self._reactions.stop()
            return True
        destination = await self._wait_candidate()
        self._finish = None
        self._state = INITIAL_STATE
        self._apply(AnswerStarted(self._ms(), self._assignment.mode))
        if self._reactions is not None:
            self._reactions.start(seq, destination)
        session = self._open_capture(destination, self._speech, self._sentence)
        self._capture = session
        capturing = asyncio.create_task(session.run())
        failed = False
        finished = False
        try:
            while self._finish is None:
                if self._left.is_set():
                    return False
                if capturing.done() and not failed:
                    failed = True
                    self._stt_failed(capturing, session, seq, destination)
                    continue
                await self._wait_event(capturing, failed)
                deadline = next_deadline(self._state)
                if deadline is not None and self._ms() >= deadline:
                    self._tick(seq, destination)
            session.stop()
            answer = await self._collect(capturing, session)
            finished = True
        finally:
            if not finished:
                session.stop()
                capturing.cancel()
                await asyncio.gather(capturing, return_exceptions=True)
            self._capture = None
            await self._stop_notice()
            if self._reactions is not None:
                await self._reactions.stop()
            await session.aclose()
        await self._deliver(FinishedAnswer(seq, answer, self._finish), destination)
        return True

    async def _chat_answer(self) -> None:
        # 질문을 마친 즉시 답변 중으로 전환한다.
        # 지원자를 기다리는 동안 수신한 [답변 완료]를 2002로 거절하지 않기 위함이다
        self._finish = None
        self._state = INITIAL_STATE
        self._apply(AnswerStarted(self._ms(), self._assignment.mode))
        while self._finish is None:
            self._wake.clear()
            await self._wake.wait()

    async def _deliver(self, finished: FinishedAnswer, destination: str) -> None:
        if self._on_answer is None:
            return
        while True:
            try:
                saved = await self._on_answer(finished)
            except ResultPublishError:
                log.error("answer.completed 전송 실패", extra={"seq": finished.seq})
                self._apply(SubmitFailed())
                self._notify(destination, finished.seq, AnswerState.SUBMIT_FAILED)
                await self._resubmit_requested()
                continue
            if saved:
                self._notify(destination, finished.seq, AnswerState.SUBMITTED)
            return

    async def _resubmit_requested(self) -> None:
        while self._state.phase is Phase.SUBMIT_FAILED:
            self._wake.clear()
            await self._wake.wait()

    async def _wait_event(self, capturing: asyncio.Task[CapturedAnswer], failed: bool) -> None:
        deadline = next_deadline(self._state)
        timeout = None if deadline is None else max(0, deadline - self._ms()) / 1000
        self._wake.clear()
        waking = asyncio.create_task(self._wake.wait())
        waiters: list[asyncio.Future[Any]] = [waking]
        if not failed:
            waiters.append(capturing)
        try:
            await asyncio.wait(waiters, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        finally:
            waking.cancel()
            await asyncio.gather(waking, return_exceptions=True)

    def _apply(self, event: AnswerEndEvent) -> Decision:
        step = next_answer_end(self._state, event)
        self._state = step.state
        return step.decision

    def _prepare_notices(self) -> None:
        # 발화 중단은 화상만 판단하므로 화상 면접에서만 합성한다
        if self._chat or self._reactions is None:
            return
        for reason in InterruptReason:
            text = INTERRUPT_PHRASES[(self._assignment.persona, reason)]
            self._notices[reason] = asyncio.create_task(self._asker.prepare_notice(text))

    def _interrupted(self, interrupt: Interrupt) -> None:
        # 답변 중에만 재생하고, 이미 재생 중이면 겹치지 않도록 새 안내는 재생하지 않는다
        if self._capture is None or interrupt.reason not in self._notices:
            return
        if self._notice is not None and not self._notice.done():
            return
        self._notice = asyncio.create_task(self._say(self._notices[interrupt.reason]))

    async def _say(self, preparing: asyncio.Task[SpeechAudio | None]) -> None:
        # 재생을 멈춰도 미리 합성한 음성은 다음 안내에 다시 쓰도록 합성은 취소하지 않는다
        audio = await asyncio.shield(preparing)
        if audio is None:
            return
        self._apply(NoticeStarted())
        self._wake.set()
        try:
            await self._asker.say(audio)
        finally:
            self._apply(NoticeEnded(self._ms()))
            self._wake.set()

    async def _stop_notice(self) -> None:
        notice, self._notice = self._notice, None
        if notice is not None:
            notice.cancel()
            await asyncio.gather(notice, return_exceptions=True)

    def _sentence(self, sentence: Sentence, answer: str) -> None:
        if self._reactions is not None:
            self._reactions.submit(sentence.text, sentence.pause_ms, answer)

    def _speech(self) -> None:
        self._apply(Speech(self._ms()))
        self._wake.set()
        if self._reactions is not None and self._capture is not None:
            self._reactions.speaking(self._capture.answer_tokens())

    def _tick(self, seq: int, destination: str) -> None:
        decision = self._apply(Tick(self._ms()))
        if decision is Decision.SUBMIT:
            self._finish = EndReason.AUTO_SUBMIT
            self._notify(destination, seq, AnswerState.AUTO_SUBMITTED)
        elif decision is Decision.TIMEOUT:
            self._notify(destination, seq, AnswerState.TIMED_OUT)

    def _stt_failed(
        self,
        capturing: asyncio.Task[CapturedAnswer],
        session: CaptureSession,
        seq: int,
        destination: str,
    ) -> None:
        error = capturing.exception() if not capturing.cancelled() else None
        log.error("답변 음성 인식 실패: %r", error, extra={"seq": seq})
        self._apply(SttError())
        session.fail()
        self._notify(destination, seq, AnswerState.STT_FAILED)

    async def _collect(
        self, capturing: asyncio.Task[CapturedAnswer], session: CaptureSession
    ) -> CapturedAnswer:
        # STT 오류 뒤 [답변 완료]면 그때까지 인식된 글로 제출한다(AI 명세 6.5)
        try:
            return await capturing
        except Exception:
            return session.snapshot()

    def _notify(self, destination: str, seq: int, state: AnswerState) -> None:
        # 화면 응답을 기다리는 동안 답변 끝 판단이 멈추지 않도록 따로 실행한다
        payload = answer_state_payload(self._assignment.session_id, seq, state)
        task = asyncio.create_task(self._send_state(destination, payload))
        self._notifications.add(task)
        task.add_done_callback(self._notifications.discard)
