"""면접 진행 시험.

7초·60초를 짧게 바꿔 실제 시간으로 진행한다.
"""

import asyncio
import json
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any

import pytest
from livekit import rtc

from app.agent import interview as interview_module
from app.agent.answer_capture import CapturedAnswer
from app.agent.assignment import AssignedQuestion, parse_assignment
from app.agent.followup import FollowupError
from app.agent.interview import FinishedAnswer, InterviewRunner
from app.agent.reaction import InvalidChatInputError
from app.agent.stt import SttError, SttState
from app.common.results import KST, ResultPublishError
from app.common.session import Persona
from app.interview.realtime import answer_end
from app.interview.realtime.interrupt import Interrupt, InterruptReason
from app.interview.realtime.progress import EndReason
from app.interview.realtime.sentence import Sentence

STARTED_AT = datetime(2026, 10, 26, 14, 0, tzinfo=KST)
CANDIDATE = "candidate"


@pytest.fixture(autouse=True)
def short_timers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(answer_end, "AUTO_SUBMIT_SILENCE_MS", 60)
    monkeypatch.setattr(answer_end, "NO_SPEECH_TIMEOUT_MS", 150)


def assignment(current_seq: int = 1, mode: str = "VIDEO", persona: str = "DEVIL") -> Any:
    return parse_assignment(
        json.dumps(
            {
                "sessionId": 55,
                "mode": mode,
                "persona": persona,
                "currentSeq": current_seq,
                "questions": [
                    {"seq": seq, "content": f"질문 {seq}", "criteria": "기준"}
                    for seq in range(1, 6)
                ],
            }
        )
    )


class FakeAsker:
    def __init__(self) -> None:
        self.prepared: list[int] = []
        # 1번 질문 합성을 끝낼 시점을 시험이 정한다(없으면 바로 끝난다)
        self.first_prepare_hold: asyncio.Event | None = None
        # 미리 만든 2번 질문 합성을 끝낼 시점을 시험이 정한다(없으면 바로 끝난다)
        self.planned_second_hold: asyncio.Event | None = None
        # 질문 글별로 합성을 끝낼 시점을 시험이 정한다(없으면 바로 끝난다)
        self.content_holds: dict[str, asyncio.Event] = {}
        # 합성을 시작한 질문 글
        self.prepared_contents: list[str] = []
        self.asked: list[tuple[int, str, Any]] = []
        # 말한 질문의 글·채점 기준·생성 버전
        self.questions: list[AssignedQuestion] = []
        self.hold: asyncio.Event | None = None
        self.speaking = asyncio.Event()
        self.notices: list[str] = []
        self.said: list[Any] = []
        # 안내 음성 재생을 끝낼 시점을 시험이 정한다
        self.notice_hold = asyncio.Event()
        self.saying = asyncio.Event()
        # question.started 전송 확인이 실패할 남은 횟수와 확인한 질문 순서
        self.started_failures = 0
        self.ensured: list[int] = []

    async def ensure_started(self, seq: int) -> bool:
        self.ensured.append(seq)
        if self.started_failures > 0:
            self.started_failures -= 1
            return False
        return True

    async def prepare(self, seq: int, question: AssignedQuestion) -> Any:
        self.prepared.append(seq)
        if seq == 1 and self.first_prepare_hold is not None:
            await self.first_prepare_hold.wait()
        if question.content == "질문 2" and self.planned_second_hold is not None:
            await self.planned_second_hold.wait()
        self.prepared_contents.append(question.content)
        hold = self.content_holds.get(question.content)
        if hold is not None:
            await hold.wait()
        # 미리 만든 질문은 순서로, 꼬리질문은 질문 글로 음성을 구분한다
        return f"audio-{seq}" if question.content == f"질문 {seq}" else f"audio-{question.content}"

    async def prepare_notice(self, text: str) -> Any:
        self.notices.append(text)
        return f"notice:{text}"

    async def say(self, audio: Any) -> None:
        self.said.append(audio)
        self.saying.set()
        try:
            await self.notice_hold.wait()
        finally:
            self.saying.clear()

    async def ask(
        self,
        seq: int,
        question: AssignedQuestion,
        destination: str,
        audio: Any,
    ) -> None:
        self.asked.append((seq, destination, audio))
        self.questions.append(question)
        self.speaking.set()
        try:
            if self.hold is not None:
                await self.hold.wait()
        finally:
            self.speaking.clear()


class FakeSession:
    def __init__(
        self,
        on_speech: Callable[[], None],
        on_sentence: Callable[[Sentence, str], None],
        on_stt_state: Callable[[SttState], None],
    ) -> None:
        self.on_speech = on_speech
        self.on_sentence = on_sentence
        self.on_stt_state = on_stt_state
        self.stopped = asyncio.Event()
        self.failure: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self.closed = False
        self.failed = False
        self.spoken = 0

    def speak(self) -> None:
        self.spoken += 1
        self.on_speech()

    def end_sentence(self, text: str) -> None:
        self.on_sentence(Sentence(text, 300.0), f"앞 {text}")

    def break_stt(self) -> None:
        self.failure.set_exception(SttError("Soniox STT에 다시 연결하지 못했습니다"))

    def answer(self) -> CapturedAnswer:
        content = "답변" * self.spoken
        return CapturedAnswer(STARTED_AT, content, None, b"pcm")

    async def run(self) -> CapturedAnswer:
        stop = asyncio.create_task(self.stopped.wait())
        try:
            await asyncio.wait((stop, self.failure), return_when=asyncio.FIRST_COMPLETED)
            if self.failure.done():
                self.failure.result()
            return self.answer()
        finally:
            stop.cancel()

    def stop(self) -> None:
        self.stopped.set()

    def snapshot(self) -> CapturedAnswer:
        return self.answer()

    def answer_tokens(self) -> Any:
        return ("tokens", self.spoken)

    def fail(self) -> None:
        self.failed = True

    async def aclose(self) -> None:
        self.closed = True


class FakeReactions:
    """리액션 판단기 대역.

    진행기가 호출한 순서를 기록한다.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []
        self.listening = False
        self.on_interrupt: Callable[[Interrupt], None] | None = None
        # 발화가 갱신될 때 전달된 답변 토큰
        self.speeches: list[Any] = []

    def start(self, question_seq: int, destination: str) -> None:
        self.listening = True
        self.calls.append(("start", question_seq, destination))

    def submit(self, text: str, pause_ms: float, answer: str) -> None:
        self.calls.append(("submit", text, pause_ms, answer))

    def speaking(self, tokens: Any) -> None:
        self.speeches.append(tokens)

    async def stop(self) -> None:
        self.listening = False
        self.calls.append(("stop",))


class FakeFollowups:
    """꼬리질문 생성기 대역.

    생성 요청을 기록하고, 결과를 반환할 시점과 실패를 시험이 정한다.
    """

    def __init__(self) -> None:
        # (면접관, 직전 질문 글, 직전 채점 기준, 답변 글, 생성할 질문 수)
        self.calls: list[tuple[Persona, str, str, str, int]] = []
        self.hold: asyncio.Event | None = None
        # 호출 순서마다 발생시킬 오류. 없으면 생성에 성공한다
        self.errors: list[Exception | None] = []

    async def generate(
        self, persona: Persona, question: AssignedQuestion, answer: str, count: int
    ) -> tuple[AssignedQuestion, ...]:
        self.calls.append((persona, question.content, question.criteria, answer, count))
        error = self.errors.pop(0) if self.errors else None
        if self.hold is not None:
            await self.hold.wait()
        if error is not None:
            raise error
        return tuple(
            AssignedQuestion(
                f"꼬리 {question.content}-{index}", f"꼬리 기준 {index}", "followup-v1", "gpt-test"
            )
            for index in range(1, count + 1)
        )


class Harness:
    def __init__(
        self,
        current_seq: int = 1,
        mode: str = "VIDEO",
        persona: str = "DEVIL",
        followups: FakeFollowups | None = None,
    ) -> None:
        self.asker = FakeAsker()
        self.sessions: list[FakeSession] = []
        self.states: list[tuple[int, str]] = []
        self.answers: list[FinishedAnswer] = []
        self.deliveries: list[int] = []
        # 남은 결과 큐 전송 실패 횟수
        self.publish_failures = 0
        self.saved = True
        self.running: asyncio.Task[None] | None = None
        self.session_opened = asyncio.Event()
        self.reactions = FakeReactions()
        # 다음 질문 전 대기마다 (대기 시간, 그때까지 말한 질문 수)
        self.sleeps: list[tuple[float, int]] = []
        # 다음 질문 전 대기를 실제로 기다릴 시간(초). 시험을 빠르게 하려고 기본은 기다리지 않는다
        self.sleep_seconds = 0.0
        self.runner = InterviewRunner(
            assignment(current_seq, mode, persona),
            self.asker,
            self.open_capture,
            self.send_state,
            on_answer=self.on_answer,
            reactions=self.reactions,  # type: ignore[arg-type]
            followups=followups,
            sleep=self.sleep,
        )

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append((seconds, len(self.asker.asked)))
        await asyncio.sleep(self.sleep_seconds)

    def open_capture(
        self,
        identity: str,
        on_speech: Callable[[], None],
        on_sentence: Callable[[Sentence, str], None],
        on_stt_state: Callable[[SttState], None],
    ) -> FakeSession:
        assert identity == CANDIDATE
        session = FakeSession(on_speech, on_sentence, on_stt_state)
        self.sessions.append(session)
        self.session_opened.set()
        return session

    async def send_state(self, destination: str, payload: str) -> None:
        message = json.loads(payload)
        assert destination == CANDIDATE
        assert (message["type"], message["sessionId"]) == ("answer.state", 55)
        self.states.append((message["seq"], message["state"]))

    async def on_answer(self, answer: FinishedAnswer) -> bool:
        self.deliveries.append(answer.seq)
        await asyncio.sleep(0)
        if self.publish_failures:
            self.publish_failures -= 1
            raise ResultPublishError("결과 메시지 전송 4회 실패")
        if self.saved:
            self.answers.append(answer)
        return self.saved

    async def next_session(self) -> FakeSession:
        count = len(self.sessions)
        while len(self.sessions) == count:
            self.session_opened.clear()
            await asyncio.wait_for(self.session_opened.wait(), timeout=1)
        return self.sessions[-1]

    def submit(self, seq: int, content: str | None = None) -> str:
        return self.runner.submit_requested(
            json.dumps({"type": "answer.submit", "sessionId": 55, "seq": seq, "content": content})
        )


async def until(check: Callable[[], bool]) -> None:
    for _ in range(200):
        if check():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("조건을 만족하지 않았다")


def run_async(
    scenario: Callable[[Harness], Awaitable[None]],
    current_seq: int = 1,
    mode: str = "VIDEO",
    persona: str = "DEVIL",
    followups: FakeFollowups | None = None,
) -> Harness:
    async def main() -> Harness:
        harness = Harness(current_seq, mode, persona, followups)
        harness.runner.candidate_joined(CANDIDATE)
        running = asyncio.create_task(harness.runner.run())
        harness.running = running
        try:
            await scenario(harness)
        finally:
            if not running.done():
                running.cancel()
            await asyncio.gather(running, return_exceptions=True)
        return harness

    return asyncio.run(main())


def rpc_code(call: Callable[[], object]) -> int:
    with pytest.raises(rtc.RpcError) as raised:
        call()
    return raised.value.code


def test_runs_every_question_with_auto_submit() -> None:
    async def scenario(h: Harness) -> None:
        for _ in range(5):
            session = await h.next_session()
            session.speak()
        # 마지막 답변의 submitted까지 확인하도록 진행이 스스로 끝날 때까지 기다린다
        assert h.running is not None
        await asyncio.wait_for(h.running, timeout=1)

    h = run_async(scenario)
    assert [a.seq for a in h.answers] == [1, 2, 3, 4, 5]
    assert {a.end_reason for a in h.answers} == {EndReason.AUTO_SUBMIT}
    assert [(seq, audio) for seq, _, audio in h.asker.asked] == [
        (seq, f"audio-{seq}") for seq in range(1, 6)
    ]
    assert h.states == [
        state for seq in range(1, 6) for state in ((seq, "autoSubmitted"), (seq, "submitted"))
    ]
    assert all(s.closed for s in h.sessions)


def auto_submit_every_question() -> Callable[[Harness], Awaitable[None]]:
    async def scenario(h: Harness) -> None:
        for _ in range(5):
            (await h.next_session()).speak()
        assert h.running is not None
        await asyncio.wait_for(h.running, timeout=1)

    return scenario


# 기준: AI 명세 6.2 호응(오리 면접관의 효과음은 화면이 재생하고 에이전트는 다음 질문 전에 기다림)
def test_duck_waits_before_next_question_but_not_after_last_answer() -> None:
    h = run_async(auto_submit_every_question(), persona="DUCK")

    # 질문을 말하기 전에 기다리므로 n번 질문까지 말한 상태에서 n+1번 질문 전에 기다린다
    assert h.sleeps == [(1.0, 1), (1.0, 2), (1.0, 3), (1.0, 4)]


@pytest.mark.parametrize("persona", ["DEVIL", "COFFEE_CHAT"])
def test_other_interviewers_do_not_wait_before_next_question(persona: str) -> None:
    h = run_async(auto_submit_every_question(), persona=persona)

    assert h.sleeps == []


def test_starts_from_current_seq() -> None:
    async def scenario(h: Harness) -> None:
        for _ in range(2):
            (await h.next_session()).speak()
        await until(lambda: len(h.answers) == 2)

    h = run_async(scenario, current_seq=4)
    assert [a.seq for a in h.answers] == [4, 5]


def test_next_question_audio_is_prepared_while_answering() -> None:
    async def scenario(h: Harness) -> None:
        await h.next_session()
        assert h.asker.prepared == [1, 2]

    run_async(scenario)


# ElevenLabs 동시 요청 상한을 넘지 않도록 앞 질문 합성이 끝난 뒤 다음 질문을 합성한다
def test_next_question_is_synthesized_after_previous_one() -> None:
    async def scenario(h: Harness) -> None:
        hold = h.asker.first_prepare_hold = asyncio.Event()
        await until(lambda: h.asker.prepared == [1])
        await asyncio.sleep(0.02)
        assert h.asker.prepared == [1]
        hold.set()
        await until(lambda: h.asker.prepared == [1, 2])

    run_async(scenario)


def test_submit_while_question_is_playing_is_not_answering() -> None:
    async def scenario(h: Harness) -> None:
        h.asker.hold = asyncio.Event()
        await asyncio.wait_for(h.asker.speaking.wait(), timeout=1)
        assert rpc_code(lambda: h.submit(1)) == 2002
        h.asker.hold.set()
        await h.next_session()

    run_async(scenario)


def test_manual_submit_rules() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        assert rpc_code(lambda: h.submit(1)) == 2001
        session.speak()
        assert rpc_code(lambda: h.submit(2)) == 2002
        assert json.loads(h.submit(1)) == {"accepted": True}
        assert json.loads(h.submit(1)) == {"accepted": False}
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.answers[0].end_reason is EndReason.MANUAL_SUBMIT
    assert h.answers[0].answer.content == "답변"
    assert h.states == [(1, "submitted")]


def test_video_submit_for_finished_question_is_not_answering() -> None:
    async def scenario(h: Harness) -> None:
        (await h.next_session()).speak()
        await h.next_session()
        assert rpc_code(lambda: h.submit(1)) == 2002

    run_async(scenario)


def test_timed_out_once_then_answer_still_accepted() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        await until(lambda: h.states == [(1, "timedOut")])
        await asyncio.sleep(0.2)
        assert h.states == [(1, "timedOut")]
        session.speak()
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.states == [(1, "timedOut"), (1, "autoSubmitted"), (1, "submitted")]


def test_stt_failure_after_speech_submits_recognized_text_and_moves_on() -> None:
    """AI 명세 6.5: 다시 연결하지 못하면,
    인식된 글을 STT_FAILED로 제출하고 다음 질문으로 진행한다.
    """

    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        session.break_stt()
        await h.next_session()
        assert session.failed

    h = run_async(scenario)
    assert h.states == [(1, "sttFailed"), (1, "submitted")]
    assert [(a.seq, a.answer.content, a.end_reason) for a in h.answers] == [
        (1, "답변", EndReason.STT_FAILED)
    ]


def test_stt_failure_without_speech_moves_on_without_waiting() -> None:
    """발화가 없으면 [답변 완료]도 수신할 수 없으므로,
    60초를 기다리지 않고 다음 질문으로 진행한다.
    """

    async def scenario(h: Harness) -> None:
        # 빈 답변은 전달하지 않으므로(AnswerDelivery) 전달 결과를 저장하지 않음으로 둔다
        h.saved = False
        session = await h.next_session()
        session.break_stt()
        await h.next_session()

    h = run_async(scenario)
    assert h.states == [(1, "sttFailed")]
    assert h.answers == []


def test_stt_failure_with_publish_failure_waits_for_resubmit() -> None:
    """STT 실패로 제출한 답변도 전달에 실패하면 [다시 시도]를 기다리고 반복 전송하지 않는다."""

    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        h.publish_failures = 1
        session.break_stt()
        await until(lambda: (1, "submitFailed") in h.states)
        await asyncio.sleep(0.1)
        assert h.deliveries == [1]
        assert json.loads(h.submit(1)) == {"accepted": True}
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.deliveries == [1, 1]
    assert h.answers[0].end_reason is EndReason.STT_FAILED


def test_stt_reconnecting_pauses_auto_submit_until_reconnected() -> None:
    """AI 명세 6.2: 다시 연결하는 동안은 7초 계산을 멈추고, 다시 연결된 시점부터 다시 계산한다."""

    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        session.on_stt_state(SttState.RECONNECTING)
        await until(lambda: (1, "sttReconnecting") in h.states)
        # 자동 제출 시간(60ms)이 지나도 다시 연결하는 동안은 제출하지 않는다
        await asyncio.sleep(0.2)
        assert h.answers == []
        session.on_stt_state(SttState.RECONNECTED)
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.states == [(1, "sttReconnecting"), (1, "autoSubmitted"), (1, "submitted")]
    assert h.answers[0].end_reason is EndReason.AUTO_SUBMIT


def test_submit_while_reconnecting_after_speech_is_accepted() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        session.on_stt_state(SttState.RECONNECTING)
        await until(lambda: (1, "sttReconnecting") in h.states)
        assert json.loads(h.submit(1)) == {"accepted": True}
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.answers[0].end_reason is EndReason.MANUAL_SUBMIT


def test_leaving_during_answer_discards_it_and_restarts_same_question() -> None:
    async def scenario(h: Harness) -> None:
        first = await h.next_session()
        first.speak()
        h.runner.candidate_left(CANDIDATE)
        await until(lambda: first.closed)
        h.runner.candidate_joined(CANDIDATE)
        second = await h.next_session()
        second.speak()
        second.speak()
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert [a.seq for a in h.answers] == [1]
    # 전달된 답변은 재입장 뒤에 들은 답변이다
    assert h.answers[0].answer.content == "답변답변"
    # 답변 중 퇴장이면 질문은 다시 말하지 않는다
    assert [seq for seq, _, _ in h.asker.asked].count(1) == 1
    assert h.sessions[0].stopped.is_set()


def test_leaving_during_question_repeats_it() -> None:
    async def scenario(h: Harness) -> None:
        h.asker.hold = asyncio.Event()
        await asyncio.wait_for(h.asker.speaking.wait(), timeout=1)
        h.runner.candidate_left(CANDIDATE)
        await until(lambda: not h.asker.speaking.is_set())
        h.asker.hold.set()
        h.runner.candidate_joined(CANDIDATE)
        await h.next_session()

    h = run_async(scenario)
    assert [seq for seq, _, _ in h.asker.asked] == [1, 1]


def test_quick_rejoin_still_discards_answer() -> None:
    """퇴장 직후 재입장해도 퇴장 전 답변은 폐기한다."""

    async def scenario(h: Harness) -> None:
        first = await h.next_session()
        first.speak()
        h.runner.candidate_left(CANDIDATE)
        h.runner.candidate_joined(CANDIDATE)
        second = await h.next_session()
        assert first.closed
        second.speak()
        second.speak()
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.answers[0].answer.content == "답변답변"


def test_submit_failure_waits_for_resubmit_of_same_answer() -> None:
    async def scenario(h: Harness) -> None:
        h.publish_failures = 2
        session = await h.next_session()
        session.speak()
        await until(lambda: h.states[-1:] == [(1, "submitFailed")])
        await asyncio.sleep(0.1)
        # 제출에 실패한 질문에서 멈추고 다음 질문으로 진행하지 않는다
        assert len(h.sessions) == 1
        assert [seq for seq, _, _ in h.asker.asked] == [1]
        assert json.loads(h.submit(1)) == {"accepted": True}
        await until(lambda: h.states.count((1, "submitFailed")) == 2)
        assert json.loads(h.submit(1)) == {"accepted": True}
        await h.next_session()

    h = run_async(scenario)
    assert h.deliveries == [1, 1, 1]
    assert [a.end_reason for a in h.answers] == [EndReason.AUTO_SUBMIT]
    assert h.states == [
        (1, "autoSubmitted"),
        (1, "submitFailed"),
        (1, "submitFailed"),
        (1, "submitted"),
    ]


# 기준: AI 명세 6.5 질문 시작 전송 실패(question.started 전송 뒤에만 answer.completed)
def test_answer_waits_until_question_started_is_sent() -> None:
    """질문 행이 없으면 BE가 답변을 저장하지 않으므로,
    question.started를 전송하지 못했으면 답변을 전달하지 않고 submitFailed를 알린다.

    [답변 완료]를 수신하면 question.started부터 다시 확인한 뒤 같은 답변을 전달한다.
    """

    async def scenario(h: Harness) -> None:
        h.asker.started_failures = 1
        (await h.next_session()).speak()
        await until(lambda: (1, "submitFailed") in h.states)
        await asyncio.sleep(0.1)
        assert h.deliveries == []
        assert json.loads(h.submit(1)) == {"accepted": True}
        await until(lambda: (1, "submitted") in h.states)

    h = run_async(scenario)
    assert h.asker.ensured[:2] == [1, 1]
    assert h.deliveries == [1]
    assert h.states == [(1, "autoSubmitted"), (1, "submitFailed"), (1, "submitted")]


def test_submit_while_resubmitting_is_not_accepted() -> None:
    async def scenario(h: Harness) -> None:
        h.publish_failures = 1
        (await h.next_session()).speak()
        await until(lambda: (1, "submitFailed") in h.states)
        assert json.loads(h.submit(1)) == {"accepted": True}
        assert json.loads(h.submit(1)) == {"accepted": False}
        await until(lambda: (1, "submitted") in h.states)

    h = run_async(scenario)
    assert h.deliveries == [1, 1]


def test_rejoin_after_submit_failure_repeats_failure_state() -> None:
    async def scenario(h: Harness) -> None:
        h.publish_failures = 1
        (await h.next_session()).speak()
        await until(lambda: (1, "submitFailed") in h.states)
        h.runner.candidate_left(CANDIDATE)
        h.runner.candidate_joined(CANDIDATE)
        await until(lambda: h.states.count((1, "submitFailed")) == 2)
        assert json.loads(h.submit(1)) == {"accepted": True}
        await h.next_session()

    h = run_async(scenario)
    assert h.deliveries == [1, 1]


def test_answer_that_cannot_be_saved_moves_on_without_submitted() -> None:
    async def scenario(h: Harness) -> None:
        h.saved = False
        (await h.next_session()).speak()
        await h.next_session()

    h = run_async(scenario)
    assert h.deliveries == [1]
    assert h.states == [(1, "autoSubmitted")]


async def asked(h: Harness, count: int) -> None:
    await until(lambda: len(h.asker.asked) == count)


def test_chat_moves_to_next_question_on_submit_without_listening() -> None:
    async def scenario(h: Harness) -> None:
        for seq in range(1, 6):
            await asked(h, seq)
            await until(lambda: not h.asker.speaking.is_set())
            assert json.loads(h.submit(seq)) == {"accepted": True}
        await asyncio.sleep(0.05)

    h = run_async(scenario, mode="CHAT")
    assert [seq for seq, _, _ in h.asker.asked] == [1, 2, 3, 4, 5]
    # 채팅 답변은 화면이 5.7로 저장하므로 음성을 듣거나 답변을 전달하지 않는다
    assert h.sessions == []
    assert h.deliveries == []
    assert h.states == []


def test_chat_submit_rules() -> None:
    async def scenario(h: Harness) -> None:
        h.asker.hold = asyncio.Event()
        await asyncio.wait_for(h.asker.speaking.wait(), timeout=1)
        assert rpc_code(lambda: h.submit(1)) == 2002
        h.asker.hold.set()
        await until(lambda: not h.asker.speaking.is_set())
        assert rpc_code(lambda: h.submit(2)) == 2002
        assert json.loads(h.submit(1)) == {"accepted": True}
        await asked(h, 2)
        # 이미 진행한 질문의 [답변 완료]는 받지 않는다(5.7 409 뒤 다시 전송)
        assert json.loads(h.submit(1)) == {"accepted": False}
        assert len(h.asker.asked) == 2

    run_async(scenario, mode="CHAT")


def test_chat_resumed_from_current_seq_ignores_earlier_question() -> None:
    async def scenario(h: Harness) -> None:
        await asked(h, 1)
        assert json.loads(h.submit(2)) == {"accepted": False}
        assert rpc_code(lambda: h.submit(4)) == 2002

    h = run_async(scenario, current_seq=3, mode="CHAT")
    assert [seq for seq, _, _ in h.asker.asked] == [3]


def test_chat_keeps_waiting_for_same_answer_after_rejoin() -> None:
    async def scenario(h: Harness) -> None:
        await asked(h, 1)
        await until(lambda: not h.asker.speaking.is_set())
        h.runner.candidate_left(CANDIDATE)
        await asyncio.sleep(0.05)
        h.runner.candidate_joined(CANDIDATE)
        assert json.loads(h.submit(1)) == {"accepted": True}
        await asked(h, 2)

    h = run_async(scenario, mode="CHAT")
    assert [seq for seq, _, _ in h.asker.asked] == [1, 2]


def test_closing_room_drops_answer_in_progress() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()

    h = run_async(scenario)
    assert h.answers == []
    assert h.sessions[0].closed


def test_other_candidate_identity_leaving_is_ignored() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        h.runner.candidate_left("recorder")
        session.speak()
        await until(lambda: len(h.answers) == 1)

    run_async(scenario)


def test_monotonic_clock_is_the_default() -> None:
    assert interview_module._monotonic_ms() >= 0


def test_video_sentences_are_judged_only_while_listening() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        session.end_sentence("첫 문장이에요.")
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.reactions.calls[:3] == [
        ("start", 1, CANDIDATE),
        ("submit", "첫 문장이에요.", 300.0, "앞 첫 문장이에요."),
        ("stop",),
    ]


def test_leaving_stops_reactions_and_rejoin_listens_to_same_question() -> None:
    async def scenario(h: Harness) -> None:
        first = await h.next_session()
        first.speak()
        h.runner.candidate_left(CANDIDATE)
        await until(lambda: first.closed)
        h.runner.candidate_joined(CANDIDATE)
        (await h.next_session()).speak()
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.reactions.calls[:4] == [
        ("start", 1, CANDIDATE),
        ("stop",),
        ("start", 1, CANDIDATE),
        ("stop",),
    ]


def chat_input(h: Harness, question_seq: int, seq: int, text: str = "입력") -> Any:
    payload = {
        "type": "chat.input",
        "sessionId": 55,
        "questionSeq": question_seq,
        "seq": seq,
        "text": text,
        "pauseMs": 800,
    }
    return json.loads(h.runner.chat_input_received(json.dumps(payload)))


def test_chat_reactions_listen_from_question_until_submit() -> None:
    async def scenario(h: Harness) -> None:
        await asked(h, 1)
        # 질문 음성 재생 중의 입력도 현재 질문의 입력이다
        assert chat_input(h, 1, 1, "첫 입력") == {"accepted": True}
        await until(lambda: not h.asker.speaking.is_set())
        assert chat_input(h, 1, 2, "첫 입력입니다. 이어서 쓰는 중") == {"accepted": True}
        h.submit(1)
        await asked(h, 2)
        await asyncio.sleep(0.02)

    h = run_async(scenario, mode="CHAT")
    # 반응 여부는 마지막 문장으로, 태도는 입력 전체로 판단한다
    assert h.reactions.calls[:5] == [
        ("start", 1, CANDIDATE),
        ("submit", "첫 입력", 800.0, "첫 입력"),
        ("submit", "이어서 쓰는 중", 800.0, "첫 입력입니다. 이어서 쓰는 중"),
        ("stop",),
        ("start", 2, CANDIDATE),
    ]


def test_chat_input_rules() -> None:
    async def scenario(h: Harness) -> None:
        await asked(h, 1)
        assert chat_input(h, 1, 3) == {"accepted": True}
        # 이미 수신한 seq 이하는 늦게 도착한 이전 입력이다
        assert chat_input(h, 1, 3) == {"accepted": False}
        assert chat_input(h, 1, 2) == {"accepted": False}
        # 현재 질문이 아니다
        assert chat_input(h, 2, 4) == {"accepted": False}
        h.runner.candidate_left(CANDIDATE)
        h.runner.candidate_joined(CANDIDATE)
        # 새로 연결한 화면은 seq를 1부터 다시 보낸다
        assert chat_input(h, 1, 1) == {"accepted": True}

    h = run_async(scenario, mode="CHAT")
    assert [call[1] for call in h.reactions.calls if call[0] == "submit"] == ["입력", "입력"]


def test_video_does_not_accept_chat_input() -> None:
    async def scenario(h: Harness) -> None:
        await h.next_session()
        assert chat_input(h, 1, 1) == {"accepted": False}

    h = run_async(scenario)
    assert [call for call in h.reactions.calls if call[0] == "submit"] == []


@pytest.mark.parametrize(
    "change",
    [
        {"type": "answer.submit"},
        {"sessionId": 56},
        {"questionSeq": 6},
        {"seq": 0},
        {"seq": True},
        {"text": "가" * 1_001},
        {"pauseMs": -1},
        {"pauseMs": "800"},
    ],
)
def test_malformed_chat_input_is_rejected(change: dict[str, Any]) -> None:
    payload = {
        "type": "chat.input",
        "sessionId": 55,
        "questionSeq": 1,
        "seq": 1,
        "text": "입력",
        "pauseMs": 800,
        **change,
    }
    runner = Harness(mode="CHAT").runner
    with pytest.raises(InvalidChatInputError):
        runner.chat_input_received(json.dumps(payload))


def test_speech_updates_pass_answer_tokens_for_long_answer_check() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        session.speak()
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.reactions.speeches[:2] == [("tokens", 1), ("tokens", 2)]


TOO_LONG = Interrupt(InterruptReason.TOO_LONG, "핵심만 짧게 말씀해 주세요.")


@pytest.fixture
def speak_notices(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(interview_module, "SPEAK_NOTICES", True)


# 안내 음성을 끄면 합성하지 않고, 발화 중단을 판단해도 말하지 않는다
# (화면은 리액션 메시지의 안내 글로 진행)
def test_notices_are_not_synthesized_while_turned_off() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        assert h.reactions.on_interrupt is not None
        h.reactions.on_interrupt(TOO_LONG)
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.asker.notices == []
    assert h.asker.said == []
    assert h.answers[0].end_reason is EndReason.AUTO_SUBMIT


@pytest.mark.usefixtures("speak_notices")
def test_notices_are_prepared_for_persona_only_in_video() -> None:
    async def scenario(h: Harness) -> None:
        await h.next_session()

    h = run_async(scenario)
    assert h.asker.notices == ["질문으로 다시 돌아가 볼게요.", "핵심만 짧게 말씀해 주세요."]

    async def chat(h: Harness) -> None:
        await asked(h, 1)

    assert run_async(chat, mode="CHAT").asker.notices == []


@pytest.mark.usefixtures("speak_notices")
def test_notice_pauses_auto_submit_until_it_ends() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        assert h.reactions.on_interrupt is not None
        h.reactions.on_interrupt(TOO_LONG)
        await asyncio.wait_for(h.asker.saying.wait(), timeout=1)
        # 재생 중에는 7초(시험에서는 60ms)가 지나도 자동 제출하지 않는다
        await asyncio.sleep(0.15)
        assert h.answers == []
        h.asker.notice_hold.set()
        await until(lambda: len(h.answers) == 1)

    h = run_async(scenario)
    assert h.asker.said == ["notice:핵심만 짧게 말씀해 주세요."]
    assert h.answers[0].end_reason is EndReason.AUTO_SUBMIT


@pytest.mark.usefixtures("speak_notices")
def test_submit_during_notice_stops_it_and_submits() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        assert h.reactions.on_interrupt is not None
        h.reactions.on_interrupt(TOO_LONG)
        await asyncio.wait_for(h.asker.saying.wait(), timeout=1)
        assert json.loads(h.submit(1)) == {"accepted": True}
        await until(lambda: len(h.answers) == 1)
        assert not h.asker.saying.is_set()

    h = run_async(scenario)
    assert h.answers[0].end_reason is EndReason.MANUAL_SUBMIT


@pytest.mark.usefixtures("speak_notices")
def test_leaving_stops_notice() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        assert h.reactions.on_interrupt is not None
        h.reactions.on_interrupt(TOO_LONG)
        await asyncio.wait_for(h.asker.saying.wait(), timeout=1)
        h.runner.candidate_left(CANDIDATE)
        await until(lambda: session.closed)
        assert not h.asker.saying.is_set()

    run_async(scenario)


@pytest.mark.usefixtures("speak_notices")
def test_notice_is_not_played_outside_answer() -> None:
    async def scenario(h: Harness) -> None:
        h.asker.hold = asyncio.Event()
        await asked(h, 1)
        assert h.reactions.on_interrupt is not None
        h.reactions.on_interrupt(TOO_LONG)
        await asyncio.sleep(0.02)
        h.asker.hold.set()

    assert run_async(scenario).asker.said == []


# 기준: AI 명세 2.2 출제 순서(1 기본 → 2 꼬리 → 3 기본 → 4·5 꼬리, 4·5는 한 번에 생성)
def test_followups_replace_second_fourth_and_fifth_questions() -> None:
    followups = FakeFollowups()
    h = run_async(auto_submit_every_question(), persona="DUCK", followups=followups)

    assert followups.calls == [
        (Persona.DUCK, "질문 1", "기준", "답변", 1),
        (Persona.DUCK, "질문 3", "기준", "답변", 2),
    ]
    assert [q.content for q in h.asker.questions] == [
        "질문 1",
        "꼬리 질문 1-1",
        "질문 3",
        "꼬리 질문 3-1",
        "꼬리 질문 3-2",
    ]
    assert [audio for _, _, audio in h.asker.asked] == [
        "audio-1",
        "audio-꼬리 질문 1-1",
        "audio-3",
        "audio-꼬리 질문 3-1",
        "audio-꼬리 질문 3-2",
    ]
    # 생성한 질문은 생성 버전을, 미리 만든 질문은 null을 question.started에 담는다(AI 명세 6.2)
    assert [(q.prompt_version, q.model_version) for q in h.asker.questions] == [
        (None, None),
        ("followup-v1", "gpt-test"),
        (None, None),
        ("followup-v1", "gpt-test"),
        ("followup-v1", "gpt-test"),
    ]
    assert [q.criteria for q in h.asker.questions][1] == "꼬리 기준 1"
    # 질문 수는 5개로 유지한다
    assert [a.seq for a in h.answers] == [1, 2, 3, 4, 5]


def test_reactions_judge_against_question_actually_asked() -> None:
    async def scenario(h: Harness) -> None:
        (await h.next_session()).speak()
        await asked(h, 2)
        assert h.runner.question(2) == "꼬리 질문 1-1"
        assert h.runner.criteria(2) == "꼬리 기준 1"
        # 아직 출제하지 않은 순서는 배정 정보의 질문이다
        assert h.runner.question(3) == "질문 3"

    run_async(scenario, followups=FakeFollowups())


# 기준: AI 명세 2.2 예비 질문(답변이 끝난 시점부터 4초 안에 생성하지 못하면 미리 만든 질문)
def test_slow_generation_falls_back_to_prepared_questions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(interview_module, "FOLLOWUP_TIMEOUT", 0.05)
    followups = FakeFollowups()
    followups.hold = asyncio.Event()
    h = run_async(auto_submit_every_question(), followups=followups)

    assert len(followups.calls) == 2
    assert [q.content for q in h.asker.questions] == [f"질문 {seq}" for seq in range(1, 6)]
    assert [audio for _, _, audio in h.asker.asked] == [f"audio-{seq}" for seq in range(1, 6)]
    assert {(q.prompt_version, q.model_version) for q in h.asker.questions} == {(None, None)}


def test_time_limit_counts_from_answer_end_not_from_next_question(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """오리 면접관의 효과음 대기가 생성을 기다리는 시간과 겹쳐 계산되는지 확인한다."""
    monkeypatch.setattr(interview_module, "FOLLOWUP_TIMEOUT", 0.3)
    waited: list[float] = []

    async def scenario(h: Harness) -> None:
        loop = asyncio.get_running_loop()
        h.sleep_seconds = 0.15
        (await h.next_session()).speak()
        spoke = loop.time()
        await asked(h, 2)
        waited.append(loop.time() - spoke)

    followups = FakeFollowups()
    followups.hold = asyncio.Event()
    h = run_async(scenario, persona="DUCK", followups=followups)

    assert h.asker.questions[1].content == "질문 2"
    # 발화 뒤 침묵 0.06초에 상한 0.3초를 더한 0.36초 근처에서 출제한다.
    # 효과음 대기 0.15초를 따로 더하면 0.51초가 걸린다
    assert waited[0] < 0.45


def test_generation_failure_replaces_fourth_and_fifth_together() -> None:
    followups = FakeFollowups()
    followups.errors = [None, FollowupError("questions가 2개가 아니다")]
    h = run_async(auto_submit_every_question(), followups=followups)

    assert [q.content for q in h.asker.questions] == [
        "질문 1",
        "꼬리 질문 1-1",
        "질문 3",
        "질문 4",
        "질문 5",
    ]
    assert [audio for _, _, audio in h.asker.asked][3:] == ["audio-4", "audio-5"]


def test_unexpected_generation_error_still_falls_back() -> None:
    followups = FakeFollowups()
    followups.errors = [RuntimeError("예상하지 못한 오류")]
    h = run_async(auto_submit_every_question(), followups=followups)

    assert h.asker.questions[1].content == "질문 2"


# 기준: AI 명세 2.2(직전 답변을 전송하지 않았으면 예비 질문), 6.5 저장할 수 없는 답변
def test_answer_that_cannot_be_saved_gets_prepared_question() -> None:
    async def scenario(h: Harness) -> None:
        h.saved = False
        (await h.next_session()).speak()
        await asked(h, 2)
        h.saved = True

    h = run_async(scenario, followups=FakeFollowups())
    assert h.asker.questions[1].content == "질문 2"
    assert h.asker.asked[1][2] == "audio-2"


def test_generation_starts_before_delivery_and_survives_resubmit() -> None:
    """답변 전달이 실패해 다시 전송하는 동안에도 생성 결과를 유지한다."""

    async def scenario(h: Harness) -> None:
        h.publish_failures = 1
        (await h.next_session()).speak()
        await until(lambda: (1, "submitFailed") in h.states)
        assert len(followups.calls) == 1
        assert json.loads(h.submit(1)) == {"accepted": True}
        await asked(h, 2)

    followups = FakeFollowups()
    h = run_async(scenario, followups=followups)
    assert h.asker.questions[1].content == "꼬리 질문 1-1"


def test_resumed_interview_without_previous_answer_uses_prepared_questions() -> None:
    async def scenario(h: Harness) -> None:
        for _ in range(2):
            (await h.next_session()).speak()
        await until(lambda: len(h.answers) == 2)

    followups = FakeFollowups()
    h = run_async(scenario, current_seq=4, followups=followups)
    assert followups.calls == []
    assert [q.content for q in h.asker.questions] == ["질문 4", "질문 5"]


# 기준: AI 명세 2.2 입력(채팅은 [답변 완료]의 content), 6.3 interview.answerSubmit
def test_chat_followup_uses_submitted_answer_text() -> None:
    async def scenario(h: Harness) -> None:
        await asked(h, 1)
        await until(lambda: not h.asker.speaking.is_set())
        assert json.loads(h.submit(1, "채팅 답변")) == {"accepted": True}
        await asked(h, 2)

    followups = FakeFollowups()
    h = run_async(scenario, mode="CHAT", persona="COFFEE_CHAT", followups=followups)
    assert followups.calls == [(Persona.COFFEE_CHAT, "질문 1", "기준", "채팅 답변", 1)]
    assert h.asker.questions[1].content == "꼬리 질문 1-1"


@pytest.mark.parametrize("content", [None, "  "])
def test_chat_submit_without_answer_text_gets_prepared_question(content: str | None) -> None:
    async def scenario(h: Harness) -> None:
        await asked(h, 1)
        await until(lambda: not h.asker.speaking.is_set())
        assert json.loads(h.submit(1, content)) == {"accepted": True}
        await asked(h, 2)

    followups = FakeFollowups()
    h = run_async(scenario, mode="CHAT", followups=followups)
    assert followups.calls == []
    assert h.asker.questions[1].content == "질문 2"


def test_followup_is_synthesized_after_planned_question_synthesis() -> None:
    """ElevenLabs 동시 요청 상한을 넘지 않도록 꼬리질문도 앞 질문 합성이 끝난 뒤 합성한다."""

    async def scenario(h: Harness) -> None:
        hold = h.asker.planned_second_hold = asyncio.Event()
        (await h.next_session()).speak()
        await until(lambda: len(followups.calls) == 1)
        await asyncio.sleep(0.05)
        # 2번 예비 질문 합성이 끝나지 않았으므로 꼬리질문 합성을 시작하지 않는다
        assert h.asker.prepared == [1, 2]
        hold.set()
        await asked(h, 2)

    followups = FakeFollowups()
    h = run_async(scenario, followups=followups)
    assert h.asker.prepared[:3] == [1, 2, 2]


# 기준: AI 명세 6.5 지원자 퇴장·새로고침(답변 중 퇴장하면 그 답변을 폐기)
def test_leaving_during_answer_starts_generation_once() -> None:
    """폐기한 답변으로는 생성하지 않고, 재입장 뒤 다시 수신한 답변으로 한 번만 생성한다."""

    async def scenario(h: Harness) -> None:
        first = await h.next_session()
        first.speak()
        h.runner.candidate_left(CANDIDATE)
        await until(lambda: first.closed)
        h.runner.candidate_joined(CANDIDATE)
        (await h.next_session()).speak()
        await asked(h, 2)

    followups = FakeFollowups()
    h = run_async(scenario, followups=followups)
    assert len(followups.calls) == 1
    assert h.asker.questions[1].content == "꼬리 질문 1-1"


# 기준: AI 명세 6.5 지원자 퇴장·새로고침(질문 음성 재생 중 퇴장하면 같은 질문을 다시 말함)
def test_leaving_during_followup_question_repeats_same_followup() -> None:
    async def scenario(h: Harness) -> None:
        h.asker.hold = asyncio.Event()
        await asyncio.wait_for(h.asker.speaking.wait(), timeout=1)
        h.asker.hold.set()
        h.asker.hold = asyncio.Event()
        (await h.next_session()).speak()
        await asked(h, 2)
        await until(h.asker.speaking.is_set)
        h.runner.candidate_left(CANDIDATE)
        await until(lambda: not h.asker.speaking.is_set())
        h.asker.hold.set()
        h.runner.candidate_joined(CANDIDATE)
        await asked(h, 3)

    h = run_async(scenario, followups=FakeFollowups())
    assert [(seq, audio) for seq, _, audio in h.asker.asked] == [
        (1, "audio-1"),
        (2, "audio-꼬리 질문 1-1"),
        (2, "audio-꼬리 질문 1-1"),
    ]
    assert [q.content for q in h.asker.questions][1:] == ["꼬리 질문 1-1", "꼬리 질문 1-1"]


def test_fifth_followup_is_synthesized_after_fourth_followup() -> None:
    """ElevenLabs 동시 요청 상한을 넘지 않도록
    5번 꼬리질문은 4번 꼬리질문 합성이 끝난 뒤 합성한다.
    """

    async def scenario(h: Harness) -> None:
        hold = h.asker.content_holds["꼬리 질문 3-1"] = asyncio.Event()
        for _ in range(3):
            (await h.next_session()).speak()
        await until(lambda: "꼬리 질문 3-1" in h.asker.prepared_contents)
        await asyncio.sleep(0.05)
        assert "꼬리 질문 3-2" not in h.asker.prepared_contents
        hold.set()
        await asked(h, 4)

    h = run_async(scenario, followups=FakeFollowups())
    contents = h.asker.prepared_contents
    assert contents.index("꼬리 질문 3-2") > contents.index("꼬리 질문 3-1")
