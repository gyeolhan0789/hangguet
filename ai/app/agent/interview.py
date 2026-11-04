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
  질문 음성 재생 중에 퇴장했으면 질문을 다시 말한다.
  BE에 전송하는 question.started는 질문 음성 담당(QuestionSpeaker)이 질문마다 한 번만 기록하고,
  전송하지 못하면 다시 전송한다.
- 면접방이 닫히면 진행 중인 답변은 전달하지 않는다(AI 명세 6.1).
- 다음 질문 음성은 답변을 듣는 동안 미리 합성한다(AI 명세 6장 머리말).
  ElevenLabs 동시 요청 상한(요금제)을 넘지 않도록 질문은 앞 질문 합성이 끝난 뒤 하나씩 합성한다.
- 답변 결과 전달은 on_answer가 담당한다.
  결과 큐 전송이 재시도 후에도 실패하면 submitFailed를 알리고 다음 질문으로 진행하지 않는다.
  화상 답변은 그 질문의 question.started를 전송한 뒤에만 전달하고,
  전송하지 못했으면 같은 방식으로 submitFailed를 알린다(AI 명세 6.5).
  [답변 완료]를 수신하면 question.started부터 확인해 보관한 같은 답변을 다시 전달한다(AI 명세 6.5).
  그동안 지원자가 재입장하면 화면이 실패 상태를 모르므로 submitFailed를 다시 알린다.
- 화상 답변은 문장이 끝날 때마다 리액션을 판단한다(AI 명세 6.2 3번).
  답변이 끝나거나 지원자가 퇴장하면 판단 중이던 리액션을 전송하지 않는다(AI 명세 6.5).
- 채팅은 chat.input을 수신할 때마다 리액션을 판단한다(AI 명세 6.2 3번).
  질문 음성 재생 중의 입력도 현재 질문의 입력이므로 질문을 말하기 시작할 때부터 수신한다.
  재입장한 화면은 이전 입력 seq를 모르므로 수신한 seq 기록을 초기화한다(AI 명세 6.5).
- 화상 발화 중단 안내는 면접 시작 때 미리 합성해 두고, 판단되면 답변 중에 재생한다.
  지금은 안내 음성 합성이 1번 질문과 동시 요청 자리를 다퉈 SPEAK_NOTICES로 끄고,
  화면은 리액션 메시지의 안내 글로만 진행한다.
  재생 중에는 7초를 중지하고(AI 명세 6.2 4번), 답변이 끝나거나 지원자가 퇴장하면 재생을 멈춘다.
  [답변 완료]는 재생 중에도 수락하며, 답변이 끝나므로 재생을 멈추고 제출한다(AI 명세 6.3).
- 오리 면접관의 호응 효과음은 화면이 재생하므로(API 명세 면접방 메시지),
  답변을 전달한 뒤 NEXT_QUESTION_DELAYS만큼 기다리고 다음 질문으로 진행한다(AI 명세 6.2).
  마지막 답변 뒤에는 기다리지 않는다.
- 꼬리질문(AI 명세 2.2)은 1·3번 답변이 끝나면 생성을 시작하고, 기다리지 않고 답변 전달로 넘어간다.
  다음 질문 음성을 준비하는 작업이 생성 결과를 기다리므로,
  답변 전달과 오리 면접관의 효과음 대기가 생성 시간과 겹쳐 계산된다.
  답변이 끝난 시점부터 FOLLOWUP_TIMEOUT 안에 생성하지 못하거나 실패하면
  예비 질문을 출제한다. 미리 합성하지 않은 5번 예비 질문은 이때 합성한다.
  4·5번은 한 번에 생성하므로 함께 대체한다.
  화상 답변을 BE에 전송하지 않았으면(저장할 수 없는 답변) 생성한 질문도 출제하지 않는다.
  채팅은 [답변 완료]에 담긴 답변 글로 생성하고, 글이 없으면 생성하지 않는다.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Coroutine, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from app.agent.answer_capture import CapturedAnswer
from app.agent.answer_rpc import (
    AnswerState,
    answer_state_payload,
    answer_submit_reply,
    parse_answer_submit,
)
from app.agent.assignment import AssignedQuestion, Assignment
from app.agent.followup import FollowupError
from app.agent.reaction import ReactionStream, chat_input_reply, parse_chat_input
from app.agent.tts import SpeechAudio
from app.common.answer import SpeechToken
from app.common.results import ResultPublishError
from app.common.session import MAX_SEQ, InterviewMode, Persona
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
from app.interview.realtime.followup import FOLLOWUP_SEQS, FOLLOWUP_TIMEOUT
from app.interview.realtime.interrupt import INTERRUPT_PHRASES, Interrupt, InterruptReason
from app.interview.realtime.progress import EndReason
from app.interview.realtime.sentence import Sentence, last_sentence

log = logging.getLogger(__name__)
# 발화 중단 안내를 음성으로도 말할지. 면접 시작 때 안내 2개를 합성하면 ElevenLabs 동시 요청 상한에
# 1번 질문 합성이 밀려(429) 끈다. 요금제를 정한 뒤 다시 켠다
SPEAK_NOTICES = False
# AI 명세 6.2: 다음 질문 전에 기다리는 시간(초).
# 오리 면접관의 호응 효과음은 화면이 제출을 시작할 때 재생하므로,
# 제출 처리 뒤 효과음 길이만큼 기다리면 처리 시간과 관계없이 다음 질문 음성과 겹치지 않는다.
# 화면의 효과음 파일 길이(1초 이내)와 맞춰야 한다
NEXT_QUESTION_DELAYS: Mapping[Persona, float] = {Persona.DUCK: 1.0}


class QuestionAsker(Protocol):
    async def prepare(self, seq: int, question: AssignedQuestion) -> SpeechAudio | None: ...

    async def prepare_notice(self, text: str) -> SpeechAudio | None: ...

    async def say(self, audio: SpeechAudio) -> None: ...

    async def ask(
        self,
        seq: int,
        question: AssignedQuestion,
        destination: str,
        audio: SpeechAudio | None,
    ) -> None: ...

    async def ensure_started(self, seq: int) -> bool: ...


class FollowupGenerator(Protocol):
    """꼬리질문 생성기다. 생성하지 못하면 FollowupError를 발생시킨다."""

    async def generate(
        self, persona: Persona, question: AssignedQuestion, answer: str, count: int
    ) -> tuple[AssignedQuestion, ...]: ...


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
# 출제할 질문과 미리 합성한 음성. 합성에 실패했으면 음성은 None이다
Prepared = tuple[AssignedQuestion, SpeechAudio | None]
Followups = tuple[AssignedQuestion, ...]


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
        followups: FollowupGenerator | None = None,
        monotonic_ms: Callable[[], int] = _monotonic_ms,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._assignment = assignment
        self._sleep = sleep
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
        self._prepared: dict[int, asyncio.Task[Prepared]] = {}
        self._notifications: set[asyncio.Task[None]] = set()
        self._followups = followups
        # 실제로 출제한 질문. 꼬리질문이면 배정 정보의 예비 질문과 다르다
        self._asked: dict[int, AssignedQuestion] = {}
        # 채팅 [답변 완료]로 수신한 답변 글
        self._submitted_content: str | None = None
        # 꼬리질문 생성과 꼬리질문으로 교체한 예비 질문 합성. 면접이 끝날 때 정리한다
        self._background: list[asyncio.Task[Any]] = []

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
        message = parse_answer_submit(payload, self._assignment.session_id)
        seq = message.seq
        if seq == self._seq:
            decision = self._apply(SubmitRequested())
        elif self._chat and self._seq is not None and seq < self._seq:
            decision = Decision.ALREADY_SUBMITTING
        else:
            # 지금 답할 수 있는 질문이 아니므로 답변 중 아님(2002)이다
            decision = Decision.NOT_ANSWERING
        if decision is Decision.ACCEPT:
            self._finish = EndReason.MANUAL_SUBMIT
            self._submitted_content = message.content
            self._wake.set()
        return answer_submit_reply(decision)

    def question(self, seq: int) -> str:
        """seq번으로 출제한 질문 글이다. 아직 출제하지 않았으면 배정 정보의 질문 글이다."""
        return self._issued(seq).content

    def criteria(self, seq: int) -> str:
        """seq번으로 출제한 질문의 채점 기준이다."""
        return self._issued(seq).criteria

    def _issued(self, seq: int) -> AssignedQuestion:
        return self._asked.get(seq) or self._assignment.questions[seq]

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
            # 채팅은 입력 칸 전체를 전송하므로 그 글이 지금까지의 답변이다.
            # 반응 여부는 마지막 문장으로 판단한다.
            # 전체로 판단하면 입력마다 결과가 거의 같기 때문이다(AI 명세 6.4)
            reactions.submit(last_sentence(message.text), message.pause_ms, message.text)
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
            pending = [
                *self._prepared.values(),
                *self._notifications,
                *self._notices.values(),
                *self._background,
            ]
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
        while True:
            destination = await self._wait_candidate()
            if self._chat and self._reactions is not None:
                self._reactions.start(seq, destination)
            # 질문 음성 재생 중에는 답변 중이 아니므로 [답변 완료]를 거절한다
            self._state = INITIAL_STATE
            if await self._speak(seq, destination):
                break
        while not await self._answer(seq):
            await self._wait_candidate()
        self._prepared.pop(seq, None)
        delay = NEXT_QUESTION_DELAYS.get(self._assignment.persona, 0.0)
        if delay and seq < MAX_SEQ:
            await self._sleep(delay)

    def _prepare(self, seq: int) -> None:
        if seq <= MAX_SEQ and seq not in self._prepared:
            previous = self._prepared.get(seq - 1)
            self._prepared[seq] = asyncio.create_task(self._prepare_after(previous, seq))

    async def _prepare_after(self, previous: asyncio.Task[Prepared] | None, seq: int) -> Prepared:
        # 앞 질문 합성이 끝난 뒤 합성해 동시 요청을 하나로 둔다. 앞 질문의 성공 여부와는 상관없다
        if previous is not None:
            await asyncio.wait((previous,))
        question = self._assignment.questions[seq]
        return question, await self._asker.prepare(seq, question)

    def _start_followup(self, seq: int, answer: str | None, ended: float) -> asyncio.Future[bool]:
        """seq번 답변으로 꼬리질문 생성을 시작하고 기다리지 않고 반환한다.

        ended는 답변이 끝난 이벤트 루프 시각이다.
        반환한 Future에는 답변을 BE에 전송했는지를 설정한다.
        전송하지 않은 답변의 꼬리질문은 출제하지 않는다.
        꼬리질문 순서의 음성 준비는
        생성 결과를 기다려 꼬리질문이나 예비 질문을 합성하는 작업으로 교체한다.
        """
        saved: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
        targets = FOLLOWUP_SEQS.get(seq)
        if targets is None or self._followups is None or answer is None or not answer.strip():
            return saved
        generation = asyncio.create_task(
            self._generate(seq, answer, len(targets), ended + FOLLOWUP_TIMEOUT, saved)
        )
        self._background.append(generation)
        for index, target in enumerate(targets):
            planned = self._prepared.get(target)
            if planned is not None:
                self._background.append(planned)
            # 예비 질문 합성이 없으면(5번) 앞 질문 합성 뒤에 합성해 동시 요청을 하나로 둔다
            after = planned or self._prepared.get(target - 1)
            self._prepared[target] = asyncio.create_task(
                self._prepare_followup(generation, index, target, planned, after)
            )
        return saved

    async def _generate(
        self, seq: int, answer: str, count: int, deadline: float, saved: asyncio.Future[bool]
    ) -> Followups | None:
        assert self._followups is not None
        question = self._issued(seq)
        try:
            async with asyncio.timeout_at(deadline):
                followups = await self._followups.generate(
                    self._assignment.persona, question, answer, count
                )
        except (TimeoutError, FollowupError) as e:
            log.warning("꼬리질문을 생성하지 못해 예비 질문을 출제한다: %r", e, extra={"seq": seq})
            return None
        except Exception:
            # 생성 실패는 면접 진행에 영향을 주지 않아야 하므로(AI 명세 6.5)
            # 예상하지 못한 오류도 예비 질문으로 진행하고, 원인을 찾도록 호출 경로를 남긴다
            log.exception("꼬리질문 생성 중 예상하지 못한 오류", extra={"seq": seq})
            return None
        # BE에 전송하지 않은 답변을 파고드는 질문은 출제하지 않는다(AI 명세 2.2)
        return followups if await saved else None

    async def _prepare_followup(
        self,
        generation: asyncio.Task[Followups | None],
        index: int,
        seq: int,
        planned: asyncio.Task[Prepared] | None,
        after: asyncio.Task[Prepared] | None,
    ) -> Prepared:
        await asyncio.wait((generation,))
        followups = None if generation.cancelled() else generation.result()
        if after is not None:
            await asyncio.wait((after,))
        if followups is not None:
            question = followups[index]
        elif planned is not None:
            return planned.result()
        else:
            question = self._assignment.questions[seq]
        return question, await self._asker.prepare(seq, question)

    async def _wait_candidate(self) -> str:
        await self._present.wait()
        self._left.clear()
        assert self._candidate is not None
        return self._candidate

    async def _speak(self, seq: int, destination: str) -> bool:
        """질문을 말한다.

        말하는 도중 지원자가 퇴장하면 False다.
        """
        question, audio = await self._prepared[seq]
        self._asked[seq] = question
        asking = asyncio.create_task(self._asker.ask(seq, question, destination, audio))
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
            # 채팅 답변은 화면이 답변 제출 API(5.7)로 이미 저장했다
            ended = asyncio.get_running_loop().time()
            self._start_followup(seq, self._submitted_content, ended).set_result(True)
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
            ended = asyncio.get_running_loop().time()
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
        saved = self._start_followup(seq, answer.content, ended)
        saved.set_result(
            await self._deliver(FinishedAnswer(seq, answer, self._finish), destination)
        )
        return True

    async def _chat_answer(self) -> None:
        # 질문을 마친 즉시 답변 중으로 전환한다.
        # 지원자를 기다리는 동안 수신한 [답변 완료]를 2002로 거절하지 않기 위함이다
        self._finish = None
        self._submitted_content = None
        self._state = INITIAL_STATE
        self._apply(AnswerStarted(self._ms(), self._assignment.mode))
        while self._finish is None:
            self._wake.clear()
            await self._wake.wait()

    async def _deliver(self, finished: FinishedAnswer, destination: str) -> bool:
        """답변을 BE에 전송했으면 True, 저장할 수 없는 답변이라 전송하지 않았으면 False다."""
        if self._on_answer is None:
            return True
        while True:
            try:
                # 질문 행이 없으면 BE가 답변을 저장하지 않으므로
                # 질문 시작 전송을 먼저 확인한다(AI 명세 6.5)
                if not await self._asker.ensure_started(finished.seq):
                    raise ResultPublishError("question.started를 전송하지 못했다")
                saved = await self._on_answer(finished)
            except ResultPublishError as e:
                log.error("답변 전달 실패: %s", e, extra={"seq": finished.seq})
                self._apply(SubmitFailed())
                self._notify(destination, finished.seq, AnswerState.SUBMIT_FAILED)
                await self._resubmit_requested()
                continue
            if saved:
                self._notify(destination, finished.seq, AnswerState.SUBMITTED)
            return saved

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
        if not SPEAK_NOTICES or self._chat or self._reactions is None:
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
