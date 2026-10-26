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
from app.agent.assignment import parse_assignment
from app.agent.interview import FinishedAnswer, InterviewRunner
from app.agent.stt import SttError
from app.common.results import KST, ResultPublishError
from app.interview.realtime import answer_end
from app.interview.realtime.progress import EndReason

STARTED_AT = datetime(2026, 10, 26, 14, 0, tzinfo=KST)
CANDIDATE = "candidate"


@pytest.fixture(autouse=True)
def short_timers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(answer_end, "AUTO_SUBMIT_SILENCE_MS", 60)
    monkeypatch.setattr(answer_end, "NO_SPEECH_TIMEOUT_MS", 150)


def assignment(current_seq: int = 1) -> Any:
    return parse_assignment(
        json.dumps(
            {
                "sessionId": 55,
                "mode": "VIDEO",
                "persona": "DEVIL",
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
        self.asked: list[tuple[int, str, Any, bool]] = []
        self.hold: asyncio.Event | None = None
        self.speaking = asyncio.Event()

    async def prepare(self, seq: int) -> Any:
        self.prepared.append(seq)
        return f"audio-{seq}"

    async def ask(self, seq: int, destination: str, audio: Any, *, announce: bool = True) -> None:
        self.asked.append((seq, destination, audio, announce))
        self.speaking.set()
        try:
            if self.hold is not None:
                await self.hold.wait()
        finally:
            self.speaking.clear()


class FakeSession:
    def __init__(self, on_speech: Callable[[], None]) -> None:
        self.on_speech = on_speech
        self.stopped = asyncio.Event()
        self.failure: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self.closed = False
        self.failed = False
        self.spoken = 0

    def speak(self) -> None:
        self.spoken += 1
        self.on_speech()

    def break_stt(self) -> None:
        self.failure.set_exception(SttError("Soniox STT 오류 (code=503)"))

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

    def fail(self) -> None:
        self.failed = True

    async def aclose(self) -> None:
        self.closed = True


class Harness:
    def __init__(self, current_seq: int = 1) -> None:
        self.asker = FakeAsker()
        self.sessions: list[FakeSession] = []
        self.states: list[tuple[int, str]] = []
        self.answers: list[FinishedAnswer] = []
        self.deliveries: list[int] = []
        # 남은 결과 큐 전송 실패 횟수
        self.publish_failures = 0
        self.saved = True
        self.session_opened = asyncio.Event()
        self.runner = InterviewRunner(
            assignment(current_seq),
            self.asker,
            self.open_capture,
            self.send_state,
            on_answer=self.on_answer,
        )

    def open_capture(self, identity: str, on_speech: Callable[[], None]) -> FakeSession:
        assert identity == CANDIDATE
        session = FakeSession(on_speech)
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

    def submit(self, seq: int) -> str:
        return self.runner.submit_requested(
            json.dumps({"type": "answer.submit", "sessionId": 55, "seq": seq})
        )


async def until(check: Callable[[], bool]) -> None:
    for _ in range(200):
        if check():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("조건을 만족하지 않았다")


def run_async(scenario: Callable[[Harness], Awaitable[None]], current_seq: int = 1) -> Harness:
    async def main() -> Harness:
        harness = Harness(current_seq)
        harness.runner.candidate_joined(CANDIDATE)
        running = asyncio.create_task(harness.runner.run())
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
        await until(lambda: len(h.answers) == 5)

    h = run_async(scenario)
    assert [a.seq for a in h.answers] == [1, 2, 3, 4, 5]
    assert {a.end_reason for a in h.answers} == {EndReason.AUTO_SUBMIT}
    assert [(seq, audio, announce) for seq, _, audio, announce in h.asker.asked] == [
        (seq, f"audio-{seq}", True) for seq in range(1, 6)
    ]
    assert h.states == [
        state for seq in range(1, 6) for state in ((seq, "autoSubmitted"), (seq, "submitted"))
    ]
    assert all(s.closed for s in h.sessions)


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


def test_stt_failure_after_speech_submits_recognized_text() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.speak()
        session.break_stt()
        await until(lambda: (1, "sttFailed") in h.states)
        await asyncio.sleep(0.1)
        assert h.answers == []
        assert json.loads(h.submit(1)) == {"accepted": True}
        await until(lambda: len(h.answers) == 1)
        assert session.failed

    h = run_async(scenario)
    assert h.answers[0].answer.content == "답변"


def test_stt_failure_without_speech_times_out() -> None:
    async def scenario(h: Harness) -> None:
        session = await h.next_session()
        session.break_stt()
        await until(lambda: h.states == [(1, "sttFailed"), (1, "timedOut")])
        assert rpc_code(lambda: h.submit(1)) == 2001

    run_async(scenario)


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
    assert [seq for seq, _, _, _ in h.asker.asked].count(1) == 1
    assert h.sessions[0].stopped.is_set()


def test_leaving_during_question_repeats_it_without_announcing_again() -> None:
    async def scenario(h: Harness) -> None:
        h.asker.hold = asyncio.Event()
        await asyncio.wait_for(h.asker.speaking.wait(), timeout=1)
        h.runner.candidate_left(CANDIDATE)
        await until(lambda: not h.asker.speaking.is_set())
        h.asker.hold.set()
        h.runner.candidate_joined(CANDIDATE)
        await h.next_session()

    h = run_async(scenario)
    assert [(seq, announce) for seq, _, _, announce in h.asker.asked] == [(1, True), (1, False)]


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
        assert [seq for seq, _, _, _ in h.asker.asked] == [1]
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
