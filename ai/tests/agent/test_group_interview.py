"""그룹 면접 진행기 시험(AI 명세 6.7).

방 정보를 직접 넣어 단계를 진행하고, 7초는 짧게 바꿔 실제 시간으로 진행한다.
"""

import asyncio
import json
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

import pytest
from livekit import rtc

from app.agent import group_interview
from app.agent.answer_capture import CapturedAnswer
from app.agent.answer_rpc import ANSWER_STATE_METHOD, AnswerSubmitError
from app.agent.assignment import AssignedQuestion, GroupAssignment, parse_assignment
from app.agent.followup import FollowupError
from app.agent.group_interview import CALL_PHRASE, GroupInterviewRunner, per_participant
from app.agent.group_room import RoomInfoTracker
from app.agent.interview import FinishedAnswer
from app.agent.question import QUESTION_METHOD
from app.agent.stt import SttState
from app.agent.tts import SpeechAudio
from app.common.results import KST, ResultPublishError, ResultType
from app.interview.realtime import answer_end
from app.interview.realtime.praise import Praise
from app.interview.realtime.progress import EndReason, ProgressMessage
from app.interview.realtime.sentence import Sentence
from tests.agent.test_group_assignment import group_json

# 음성 길이 1초(24kHz · 모노 · 16비트)
ONE_SECOND_PCM = bytes(48_000)


@pytest.fixture(autouse=True)
def short_timers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(answer_end, "AUTO_SUBMIT_SILENCE_MS", 60)


class FakeVoice:
    def __init__(self) -> None:
        self.prepared: list[str] = []
        self.failing: set[str] = set()
        self.texts: dict[int, str] = {}
        self.played: list[str] = []
        self.said: list[Any] = []
        # 질문 재생(play)과 칭찬(say)의 순서
        self.events: list[str] = []
        # 질문 음성을 끝낼 시점을 시험이 정한다(없으면 바로 끝난다)
        self.hold: asyncio.Event | None = None
        self.playing = asyncio.Event()

    async def prepare(self, text: str) -> SpeechAudio | None:
        self.prepared.append(text)
        if text in self.failing:
            return None
        audio = SpeechAudio(ONE_SECOND_PCM, ())
        self.texts[id(audio)] = text
        return audio

    async def play(self, audio: SpeechAudio, on_start: Callable[[], None]) -> None:
        on_start()
        self.played.append(self.texts[id(audio)])
        self.events.append("play")
        self.playing.set()
        try:
            if self.hold is not None:
                await self.hold.wait()
        finally:
            self.playing.clear()

    async def say(self, audio: Any) -> None:
        self.said.append(audio)
        self.events.append("say")


class FakeSession:
    def __init__(
        self,
        identity: str,
        session_id: int,
        on_speech: Callable[[], None],
        on_stt_state: Callable[[SttState], None],
    ) -> None:
        self.identity = identity
        self.session_id = session_id
        self.on_speech = on_speech
        self.on_stt_state = on_stt_state
        self.stopped = asyncio.Event()
        self.closed = False
        self.spoken = 0

    def speak(self) -> None:
        self.spoken += 1
        self.on_speech()

    def answer(self) -> CapturedAnswer:
        return CapturedAnswer(
            datetime(2026, 11, 4, 14, 0, tzinfo=KST), "답변" * self.spoken, None, b""
        )

    async def run(self) -> CapturedAnswer:
        await self.stopped.wait()
        return self.answer()

    def stop(self) -> None:
        self.stopped.set()

    def snapshot(self) -> CapturedAnswer:
        return self.answer()

    def answer_tokens(self) -> Any:
        return None

    def fail(self) -> None:
        pass

    async def aclose(self) -> None:
        self.closed = True


class FakeReactions:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []
        self.last_judgment = None

    def start(self, question_seq: int, destination: str) -> None:
        self.calls.append(("start", question_seq, destination))

    def submit(self, text: str, pause_ms: float, answer: str) -> None:
        self.calls.append(("submit", text))

    def speaking(self, tokens: Any) -> None:
        pass

    async def stop(self) -> None:
        self.calls.append(("stop",))


class FakeJudge:
    """꼬리질문 판단기 대역. 판단 요청을 남기고 결과(질문 · None · 오류)를 시험이 정한다."""

    def __init__(self, outcome: AssignedQuestion | Exception | None) -> None:
        self.outcome = outcome
        self.calls: list[tuple[str, str]] = []

    async def judge(
        self, persona: Any, question: AssignedQuestion, answer: str
    ) -> AssignedQuestion | None:
        self.calls.append((question.content, answer))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class Harness:
    def __init__(self, **assignment: Any) -> None:
        parsed = parse_assignment(group_json(**assignment))
        assert isinstance(parsed, GroupAssignment)
        self.assignment = parsed
        self.voice = FakeVoice()
        self.sent: list[tuple[str, str, dict[str, Any]]] = []
        self.published: list[ProgressMessage] = []
        self.publish_failures = 0
        self.sessions: list[FakeSession] = []
        self.delivered: list[tuple[int, FinishedAnswer, int]] = []
        self.deliver_failures = 0
        # 답변 전달을 끝낼 시점을 시험이 정한다(없으면 바로 끝난다)
        self.deliver_hold: asyncio.Event | None = None
        self.subscribed: list[int] = []
        self.reactions: dict[int, FakeReactions] = {}
        self.sleeps: list[float] = []
        self.praises: dict[Praise, Any] | None = None
        self.followups: FakeJudge | None = None
        self.tracker = RoomInfoTracker()
        self.runner: GroupInterviewRunner | None = None
        self.running: asyncio.Task[None] | None = None

    def start(self) -> GroupInterviewRunner:
        runner = GroupInterviewRunner(
            self.assignment,
            self.voice,
            self.send,
            self.publish,
            self.open_capture,
            self.deliver,
            self.tracker,
            subscribe=self.subscribed.append,
            reactions=lambda session_id: self.reactions.setdefault(session_id, FakeReactions()),  # type: ignore[arg-type,return-value]
            praises=self.praises,
            followups=self.followups,
            sleep=self.sleep,
        )
        self.runner = runner
        self.running = asyncio.create_task(runner.run())
        return runner

    async def send(self, destination: str, method: str, payload: str) -> None:
        self.sent.append((destination, method, json.loads(payload)))

    async def publish(self, message: ProgressMessage) -> None:
        if self.publish_failures > 0:
            self.publish_failures -= 1
            raise ResultPublishError("결과 큐 전송 실패")
        self.published.append(message)

    def open_capture(
        self,
        identity: str,
        session_id: int,
        on_speech: Callable[[], None],
        _on_sentence: Callable[[Sentence, str], None],
        on_stt_state: Callable[[SttState], None],
    ) -> FakeSession:
        session = FakeSession(identity, session_id, on_speech, on_stt_state)
        self.sessions.append(session)
        return session

    async def deliver(
        self, session_id: int, finished: FinishedAnswer, version: int, _ended: datetime
    ) -> bool:
        if self.deliver_failures > 0:
            self.deliver_failures -= 1
            raise ResultPublishError("결과 큐 전송 실패")
        self.delivered.append((session_id, finished, version))
        if self.deliver_hold is not None:
            await self.deliver_hold.wait()
        return True

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        await asyncio.sleep(0)

    def join(self, *session_ids: int) -> None:
        assert self.runner is not None
        for session_id in session_ids:
            self.runner.candidate_joined(f"candidate-{session_id}")

    def info(
        self,
        version: int,
        phase: str | None = "ASKING",
        *,
        session_id: int = 55,
        seq: int = 1,
        kind: str = "COMMON",
        base: int | None = 1,
        announce: str = "FULL",
        deadline_ms: int | None = None,
        status: str = "IN_PROGRESS",
        states: dict[int, str] | None = None,
    ) -> None:
        now = datetime.now(KST)
        turn = None
        if phase is not None:
            turn = {
                "sessionId": session_id,
                "seq": seq,
                "kind": kind,
                "baseIndex": base,
                "announce": announce,
                "deadlineAt": None
                if deadline_ms is None
                else (now + timedelta(milliseconds=deadline_ms)).isoformat(),
                "extended": False,
                "followupsLeft": 2,
            }
        people = states or {55: "PRESENT", 56: "PRESENT"}
        metadata = json.dumps(
            {
                "turnVersion": version,
                "serverTime": now.isoformat(),
                "groupStatus": status,
                "round": 1,
                "phase": phase,
                "turn": turn,
                "participants": [
                    {"sessionId": s, "turnOrder": i, "state": state}
                    for i, (s, state) in enumerate(people.items(), start=1)
                ],
                "upcoming": [],
            }
        )
        info = self.tracker.update(metadata)
        assert info is not None and self.runner is not None
        self.runner.room_info_changed(info)

    def results(self, result_type: ResultType) -> list[dict[str, Any]]:
        return [dict(m.fields) for m in self.published if m.type is result_type]

    def states(self) -> list[tuple[str, str]]:
        return [(d, p["state"]) for d, method, p in self.sent if method == ANSWER_STATE_METHOD]

    async def next_session(self, count: int) -> FakeSession:
        await until(lambda: len(self.sessions) >= count)
        return self.sessions[count - 1]

    async def answer(
        self, version: int, *, session_id: int = 55, seq: int = 1, **turn: Any
    ) -> FakeSession:
        """그 차례의 질문을 말하고 답변 듣기로 넘어간다."""
        spoken = len(self.results(ResultType.QUESTION_SPOKEN))
        self.info(version, "ASKING", session_id=session_id, seq=seq, **turn)
        await until(
            lambda: len(self.results(ResultType.QUESTION_SPOKEN)) > spoken and self.speaking_done()
        )
        self.info(version + 1, "SPEAKING", session_id=session_id, seq=seq, **turn)
        self.info(
            version + 2, "ANSWERING", session_id=session_id, seq=seq, deadline_ms=60_000, **turn
        )
        return await self.next_session(len(self.sessions) + 1)

    def speaking_done(self) -> bool:
        return not self.voice.playing.is_set()


async def until(condition: Callable[[], bool], timeout: float = 2.0) -> None:
    async def wait() -> None:
        while not condition():
            await asyncio.sleep(0.005)

    await asyncio.wait_for(wait(), timeout)


def run(scenario: Callable[[Harness], Awaitable[None]], **assignment: Any) -> Harness:
    async def main() -> Harness:
        h = Harness(**assignment)
        h.start()
        try:
            await scenario(h)
        finally:
            assert h.running is not None
            h.running.cancel()
            await asyncio.gather(h.running, return_exceptions=True)
        return h

    return asyncio.run(main())


def test_questions_are_synthesized_in_turn_order() -> None:
    async def scenario(h: Harness) -> None:
        await until(lambda: len(h.voice.prepared) == 7)

    h = run(scenario)
    assert h.voice.prepared == [
        "자기소개",
        CALL_PHRASE,
        "55 개인1",
        "56 개인1",
        "인성",
        "55 개인2",
        "56 개인2",
    ]


def test_question_is_sent_to_everyone_and_reported_with_turn_fields() -> None:
    async def scenario(h: Harness) -> None:
        h.join(55, 56)
        h.info(1, "ASKING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)

    h = run(scenario)
    assert h.voice.played == ["자기소개"]
    assert h.subscribed == [55]
    questions = [(d, p["speech"], p["content"]) for d, m, p in h.sent if m == QUESTION_METHOD]
    assert questions == [
        ("candidate-55", "started", "자기소개"),
        ("candidate-56", "started", "자기소개"),
        ("candidate-55", "ended", "자기소개"),
        ("candidate-56", "ended", "자기소개"),
    ]
    started = h.results(ResultType.QUESTION_STARTED)
    assert len(started) == 1
    assert {k: started[0][k] for k in ("seq", "turnVersion", "kind", "speechMs", "content")} == {
        "seq": 1,
        "turnVersion": 1,
        "kind": "COMMON",
        "speechMs": 1000,
        "content": "자기소개",
    }
    assert h.results(ResultType.QUESTION_SPOKEN)[0]["speech"] == "ENDED"


def test_call_turn_speaks_call_phrase_but_sends_common_question() -> None:
    """호명이면 음성만 호명 문구이고 질문 행 · 화면 글은 그 공통 질문이다(AI 명세 6.7)."""

    async def scenario(h: Harness) -> None:
        h.join(55, 56)
        h.info(1, "ASKING", session_id=56, seq=1, announce="CALL")
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)

    h = run(scenario)
    assert h.voice.played == [CALL_PHRASE]
    assert h.results(ResultType.QUESTION_STARTED)[0]["content"] == "자기소개"
    assert {p["content"] for _, m, p in h.sent if m == QUESTION_METHOD} == {"자기소개"}


@pytest.mark.parametrize(
    ("kind", "base", "expected"),
    [("PERSONAL", 2, "56 개인1"), ("COMMON", 3, "인성"), ("PERSONAL", 4, "56 개인2")],
)
def test_question_is_chosen_by_base_index(kind: str, base: int, expected: str) -> None:
    async def scenario(h: Harness) -> None:
        h.join(56)
        h.info(1, "ASKING", session_id=56, seq=base, kind=kind, base=base)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)

    assert run(scenario).voice.played == [expected]


def test_same_turn_is_asked_again_when_it_comes_back() -> None:
    """답변 중 나갔다 돌아온 사람에게는 같은 순서로 다시 묻는다(BE 그룹 면접 설계 6.9)."""

    async def scenario(h: Harness) -> None:
        h.join(55, 56)
        h.info(1, "ASKING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)
        h.info(2, "ASKING", session_id=56, seq=1, announce="CALL")
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 2)
        h.info(3, "ASKING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 3)

    h = run(scenario)
    assert h.voice.played == ["자기소개", CALL_PHRASE, "자기소개"]
    assert [m["turnVersion"] for m in h.results(ResultType.QUESTION_STARTED)] == [1, 2, 3]


def test_failed_synthesis_reports_failed_question_without_speech() -> None:
    async def scenario(h: Harness) -> None:
        h.voice.failing.add("자기소개")
        h.join(55)
        h.info(1, "ASKING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)

    h = run(scenario)
    assert h.voice.played == []
    assert [p["speech"] for _, m, p in h.sent if m == QUESTION_METHOD] == ["failed"]
    assert h.results(ResultType.QUESTION_STARTED)[0]["speechMs"] == 0
    assert h.results(ResultType.QUESTION_SPOKEN)[0]["speech"] == "FAILED"


def test_question_started_is_sent_again_until_it_succeeds() -> None:
    async def scenario(h: Harness) -> None:
        h.publish_failures = 1
        h.join(55)
        h.info(1, "ASKING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)

    h = run(scenario)
    assert len(h.results(ResultType.QUESTION_STARTED)) == 1
    assert 4.0 in h.sleeps


def test_answering_while_speaking_stops_voice_and_listens() -> None:
    """질문 음성이 끝났다는 메시지가 오지 않으면 BE가 스스로 답변 시간을 시작한다(AI 명세 6.7)."""

    async def scenario(h: Harness) -> None:
        h.voice.hold = asyncio.Event()
        h.join(55)
        h.info(1, "ASKING", session_id=55, seq=1)
        await until(h.voice.playing.is_set)
        h.info(2, "ANSWERING", session_id=55, seq=1, deadline_ms=60_000)
        await h.next_session(1)
        await until(lambda: not h.voice.playing.is_set())

    h = run(scenario)
    assert [s.identity for s in h.sessions] == ["candidate-55"]


def test_auto_submitted_answer_is_delivered_to_group_queue() -> None:
    async def scenario(h: Harness) -> None:
        h.join(55, 56)
        session = await h.answer(1, session_id=55, seq=1)
        session.speak()
        await until(lambda: len(h.delivered) == 1)
        await until(lambda: ("candidate-55", "submitted") in h.states())

    h = run(scenario)
    session_id, finished, version = h.delivered[0]
    assert (session_id, finished.seq, finished.end_reason, version) == (
        55,
        1,
        EndReason.AUTO_SUBMIT,
        3,
    )
    # 답변 상태는 답변자에게만 간다
    assert h.states() == [("candidate-55", "autoSubmitted"), ("candidate-55", "submitted")]
    assert h.sessions[0].closed


def test_deadline_submits_time_limit_when_spoken(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(answer_end, "AUTO_SUBMIT_SILENCE_MS", 60_000)

    async def scenario(h: Harness) -> None:
        h.join(55)
        h.info(1, "ANSWERING", session_id=55, seq=1, deadline_ms=150)
        (await h.next_session(1)).speak()
        await until(lambda: len(h.delivered) == 1)
        await until(lambda: ("candidate-55", "submitted") in h.states())

    h = run(scenario)
    assert h.delivered[0][1].end_reason is EndReason.TIME_LIMIT
    assert h.states() == [("candidate-55", "autoSubmitted"), ("candidate-55", "submitted")]


def test_deadline_without_speech_sends_nothing() -> None:
    """한마디도 안 했으면 내지 않는다(BE가 닫는다)."""

    async def scenario(h: Harness) -> None:
        h.join(55)
        h.info(1, "ANSWERING", session_id=55, seq=1, deadline_ms=100)
        session = await h.next_session(1)
        await until(lambda: session.closed)

    h = run(scenario)
    assert h.delivered == []
    assert h.states() == []


def test_extended_deadline_is_followed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(answer_end, "AUTO_SUBMIT_SILENCE_MS", 60_000)

    async def scenario(h: Harness) -> None:
        h.join(55)
        h.info(1, "ANSWERING", session_id=55, seq=1, deadline_ms=100)
        (await h.next_session(1)).speak()
        h.info(2, "ANSWERING", session_id=55, seq=1, deadline_ms=400)
        await asyncio.sleep(0.2)
        assert h.delivered == []
        await until(lambda: len(h.delivered) == 1)

    h = run(scenario)
    assert len(h.sessions) == 1
    assert h.delivered[0][1].end_reason is EndReason.TIME_LIMIT


def test_submit_is_taken_only_from_current_answerer_and_question() -> None:
    async def scenario(h: Harness) -> None:
        h.join(55, 56)
        session = await h.answer(1, session_id=55, seq=3, kind="COMMON", base=3)
        assert h.runner is not None
        submit = h.runner.submit_requested

        def payload(session_id: int, seq: int) -> str:
            return json.dumps({"type": "answer.submit", "sessionId": session_id, "seq": seq})

        assert json.loads(submit("candidate-56", payload(56, 3))) == {"accepted": False}
        assert json.loads(submit("candidate-55", payload(55, 2))) == {"accepted": False}
        with pytest.raises(rtc.RpcError) as empty:
            submit("candidate-55", payload(55, 3))
        assert empty.value.code == AnswerSubmitError.EMPTY_ANSWER
        session.speak()
        assert json.loads(submit("candidate-55", payload(55, 3))) == {"accepted": True}
        await until(lambda: len(h.delivered) == 1)

    h = run(scenario)
    assert h.delivered[0][1].end_reason is EndReason.MANUAL_SUBMIT


def test_chat_does_not_listen_and_rejects_submit() -> None:
    """채팅은 BE가 답변을 확정하므로 듣지 않는다(AI 명세 6.7)."""

    async def scenario(h: Harness) -> None:
        h.join(55)
        h.info(1, "ANSWERING", session_id=55, seq=1, deadline_ms=60_000)
        await asyncio.sleep(0.05)
        assert h.runner is not None
        payload = json.dumps({"type": "answer.submit", "sessionId": 55, "seq": 1})
        with pytest.raises(rtc.RpcError) as error:
            h.runner.submit_requested("candidate-55", payload)
        assert error.value.code == AnswerSubmitError.NOT_ANSWERING

    h = run(scenario, mode="CHAT")
    assert h.sessions == []
    assert h.subscribed == []


def test_answer_of_leaving_answerer_is_discarded() -> None:
    async def scenario(h: Harness) -> None:
        h.join(55)
        session = await h.answer(1, session_id=55, seq=1)
        session.speak()
        assert h.runner is not None
        h.runner.candidate_left("candidate-55")
        await until(lambda: session.closed)

    h = run(scenario)
    assert h.delivered == []


def test_waits_for_answerer_to_join() -> None:
    async def scenario(h: Harness) -> None:
        h.info(1, "ANSWERING", session_id=55, seq=1, deadline_ms=60_000)
        await asyncio.sleep(0.05)
        assert h.sessions == []
        h.join(55)
        await h.next_session(1)

    run(scenario)


def test_newer_turn_stops_listening() -> None:
    async def scenario(h: Harness) -> None:
        h.join(55, 56)
        session = await h.answer(1, session_id=55, seq=1)
        session.speak()
        h.info(10, "ASKING", session_id=56, seq=1, announce="CALL")
        await until(lambda: session.closed)

    h = run(scenario)
    assert h.delivered == []
    assert h.subscribed == [55, 56]


def test_failed_delivery_waits_for_retry() -> None:
    async def scenario(h: Harness) -> None:
        h.deliver_failures = 1
        h.join(55)
        session = await h.answer(1, session_id=55, seq=1)
        session.speak()
        await until(lambda: ("candidate-55", "submitFailed") in h.states())
        assert h.runner is not None
        payload = json.dumps({"type": "answer.submit", "sessionId": 55, "seq": 1})
        assert json.loads(h.runner.submit_requested("candidate-55", payload)) == {"accepted": True}
        await until(lambda: ("candidate-55", "submitted") in h.states())

    h = run(scenario)
    assert len(h.delivered) == 1


def test_deciding_reports_no_followup_once() -> None:
    """꼬리질문 판단(S15P31A301-527) 전까지 바로 필요 없음을 보낸다. 같은 질문은 한 번만이다."""

    async def scenario(h: Harness) -> None:
        h.info(4, "DECIDING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
        h.info(5, "DECIDING", session_id=55, seq=1)
        await asyncio.sleep(0.05)

    h = run(scenario)
    decided = h.results(ResultType.FOLLOWUP_DECIDED)
    assert len(decided) == 1
    assert (decided[0]["seq"], decided[0]["turnVersion"], decided[0]["needed"]) == (1, 4, False)


def test_duck_praises_after_answer_unless_answerer_is_done() -> None:
    """1~3번째 기본 질문은 마지막일 수 없어 판단을 기다리지 않고 1초 뒤 칭찬한다.

    4번째 기본 질문은 BE가 그 차례를 넘겨야 마지막인지 알고,
    마지막 질문을 마친 사람(DONE)은 칭찬하지 않는다(AI 명세 6.2 · 6.7).
    """
    praise_audio = object()

    async def scenario(h: Harness) -> None:
        h.praises = {p: praise_audio for p in Praise}
        h.start()
        h.join(55, 56)
        session = await h.answer(1, session_id=55, seq=1)
        session.speak()
        await until(lambda: len(h.voice.said) == 1)
        later = await h.answer(5, session_id=56, seq=4, kind="PERSONAL", base=4)
        later.speak()
        await until(lambda: len(h.delivered) == 2)
        h.info(8, "DECIDING", session_id=56, seq=4, kind="PERSONAL", base=4)
        await asyncio.sleep(0.05)
        assert len(h.voice.said) == 1
        h.info(10, None, states={55: "PRESENT", 56: "DONE"})
        await asyncio.sleep(0.05)

    async def main() -> Harness:
        h = Harness(persona="DUCK")
        try:
            await scenario(h)
        finally:
            assert h.running is not None
            h.running.cancel()
            await asyncio.gather(h.running, return_exceptions=True)
        return h

    h = asyncio.run(main())
    assert h.voice.said == [praise_audio]
    assert 1.0 in h.sleeps


def test_duck_waits_for_turn_after_followup_of_last_base_question() -> None:
    """4번째 기본 질문 뒤 꼬리질문이 정해지면 마지막이 아니므로 그 차례로 넘어갈 때 칭찬한다.

    그 꼬리질문도 마지막일 수 있어 차례가 넘어간 뒤 칭찬할지 정한다.
    """

    async def main() -> Harness:
        h = Harness(persona="DUCK")
        h.praises = {p: object() for p in Praise}
        h.followups = FakeJudge(FOLLOWUP)
        h.start()
        try:
            h.join(55)
            first = await h.answer(1, session_id=55, seq=4, kind="PERSONAL", base=4)
            first.speak()
            await until(lambda: len(h.delivered) == 1)
            h.info(4, "DECIDING", session_id=55, seq=4, kind="PERSONAL", base=4)
            await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
            await asyncio.sleep(0.02)
            assert h.voice.said == []
            followup = await h.answer(5, session_id=55, seq=5, kind="FOLLOWUP", base=None)
            assert len(h.voice.said) == 1
            followup.speak()
            await until(lambda: len(h.delivered) == 2)
            await asyncio.sleep(0.05)
            assert len(h.voice.said) == 1
            h.info(9, None, states={55: "DONE", 56: "PRESENT"})
            await asyncio.sleep(0.05)
        finally:
            assert h.running is not None
            h.running.cancel()
            await asyncio.gather(h.running, return_exceptions=True)
        return h

    assert len(asyncio.run(main()).voice.said) == 1


def test_group_end_stops_progress() -> None:
    async def scenario(h: Harness) -> None:
        h.info(1, None, status="ENDED")
        assert h.running is not None
        await asyncio.wait_for(h.running, timeout=1)

    run(scenario)


def test_reaction_judge_is_kept_per_participant() -> None:
    """태도 · 리액션 순번은 그 사람 면접 전체에 이어진다(AI 명세 6.4 · 6.5)."""
    made: list[int] = []

    def make(session_id: int) -> Any:
        made.append(session_id)
        return object()

    reactions = per_participant(make)

    assert reactions(55) is reactions(55)
    assert reactions(56) is not reactions(55)
    assert made == [55, 56]


def chat_input(session_id: int, question_seq: int, seq: int, text: str = "경험을 말하면") -> str:
    return json.dumps(
        {
            "type": "chat.input",
            "sessionId": session_id,
            "questionSeq": question_seq,
            "seq": seq,
            "text": text,
            "pauseMs": 800,
        }
    )


def test_chat_input_is_taken_only_from_answerer_for_current_question() -> None:
    """보낸 사람 · sessionId · questionSeq가 지금 차례이고 순번이 커질 때만 판단한다.

    기준: AI 명세 6.3 · 6.7
    """

    async def scenario(h: Harness) -> None:
        h.join(55, 56)
        h.info(1, "ASKING", session_id=55, seq=2, kind="PERSONAL", base=2)
        await until(lambda: 55 in h.reactions)
        assert h.reactions[55].calls == [("start", 2, "candidate-55")]
        assert h.runner is not None
        received = h.runner.chat_input_received

        def reply(caller: str, payload: str) -> bool:
            return bool(json.loads(received(caller, payload))["accepted"])

        assert not reply("candidate-56", chat_input(56, 2, 1))
        assert not reply("candidate-55", chat_input(56, 2, 1))
        assert not reply("candidate-55", chat_input(55, 1, 1))
        assert not reply("candidate-55", "{broken")
        assert reply("candidate-55", chat_input(55, 2, 1, "첫 문장이다. 두 번째"))
        assert not reply("candidate-55", chat_input(55, 2, 1))
        assert reply("candidate-55", chat_input(55, 2, 2))
        # 새로 연결한 화면은 순번을 1부터 다시 센다(AI 명세 6.5)
        h.join(55)
        assert reply("candidate-55", chat_input(55, 2, 1))

    h = run(scenario, mode="CHAT")
    submits = [c for c in h.reactions[55].calls if c[0] == "submit"]
    # 반응 여부는 마지막 문장으로 판단한다(AI 명세 6.4)
    assert submits[0] == ("submit", "두 번째")
    assert len(submits) == 3


def test_chat_reactions_stop_when_answer_is_decided() -> None:
    async def scenario(h: Harness) -> None:
        h.join(55)
        h.info(1, "ASKING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)
        h.info(2, "SPEAKING", session_id=55, seq=1)
        h.info(3, "ANSWERING", session_id=55, seq=1, deadline_ms=300_000)
        await asyncio.sleep(0.02)
        assert h.runner is not None
        assert json.loads(h.runner.chat_input_received("candidate-55", chat_input(55, 1, 1)))[
            "accepted"
        ]
        h.info(4, "DECIDING", session_id=55, seq=1)
        await until(lambda: ("stop",) in h.reactions[55].calls)
        assert not json.loads(h.runner.chat_input_received("candidate-55", chat_input(55, 1, 2)))[
            "accepted"
        ]

    h = run(scenario, mode="CHAT")
    assert [c[0] for c in h.reactions[55].calls].count("start") == 1


def test_video_group_does_not_take_chat_input() -> None:
    async def scenario(h: Harness) -> None:
        h.join(55)
        h.info(1, "ASKING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)
        assert h.runner is not None
        assert not json.loads(h.runner.chat_input_received("candidate-55", chat_input(55, 1, 1)))[
            "accepted"
        ]

    run(scenario)


def duck_group(scenario: Callable[[Harness], Awaitable[None]], mode: str) -> Harness:
    async def main() -> Harness:
        h = Harness(persona="DUCK", mode=mode)
        h.praises = {p: object() for p in Praise}
        h.start()
        try:
            await scenario(h)
        finally:
            assert h.running is not None
            h.running.cancel()
            await asyncio.gather(h.running, return_exceptions=True)
        return h

    return asyncio.run(main())


def test_chat_duck_praises_at_decision_before_next_question() -> None:
    """채팅은 DECIDING이 오면(BE가 답변을 저장함) 1초 뒤 칭찬하고 다음 질문은 그 뒤에 말한다."""

    async def scenario(h: Harness) -> None:
        h.join(55, 56)
        h.info(1, "ASKING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)
        h.info(2, "DECIDING", session_id=55, seq=1)
        # BE는 판단(followup.decided)을 받은 뒤 다음 차례를 정한다
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
        h.info(3, "ASKING", session_id=56, seq=1, announce="CALL")
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 2)
        # 같은 질문의 DECIDING이 다시 와도 한 번만 칭찬한다
        h.info(4, "DECIDING", session_id=55, seq=1)
        await asyncio.sleep(0.05)

    h = duck_group(scenario, "CHAT")
    assert h.voice.events == ["play", "say", "play"]
    assert 1.0 in h.sleeps


def test_chat_duck_does_not_praise_after_last_question() -> None:
    async def scenario(h: Harness) -> None:
        h.join(55)
        h.info(1, "DECIDING", session_id=55, seq=4, kind="PERSONAL", base=4)
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
        h.info(2, None, states={55: "DONE", 56: "PRESENT"})
        await asyncio.sleep(0.05)

    h = duck_group(scenario, "CHAT")
    assert h.voice.said == []
    assert 1.0 in h.sleeps


def test_video_duck_does_not_praise_again_at_decision() -> None:
    """화상은 답변을 전달한 뒤 이미 칭찬하므로 DECIDING에서는 칭찬하지 않는다."""

    async def scenario(h: Harness) -> None:
        h.info(1, "DECIDING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
        await asyncio.sleep(0.05)

    assert duck_group(scenario, "VIDEO").voice.said == []


FOLLOWUP = AssignedQuestion(
    "기준은 어떻게 정했나요?", "판단 근거", "group-followup-v1", "gms-model"
)


def group_answer(session_id: int, seq: int, content: str) -> str:
    return json.dumps({"sessionId": session_id, "seq": seq, "content": content, "turnVersion": 9})


def run_with_judge(
    scenario: Callable[[Harness], Awaitable[None]],
    outcome: AssignedQuestion | Exception | None,
    **assignment: Any,
) -> Harness:
    async def main() -> Harness:
        h = Harness(**assignment)
        h.followups = FakeJudge(outcome)
        h.start()
        try:
            await scenario(h)
        finally:
            assert h.running is not None
            h.running.cancel()
            await asyncio.gather(h.running, return_exceptions=True)
        return h

    return asyncio.run(main())


def test_video_followup_is_judged_with_delivered_answer_and_asked_on_followup_turn() -> None:
    """판단 재료는 보낸 답변 글이고, 만든 꼬리질문은 그 사람의 FOLLOWUP 차례에 말한다.

    기준: AI 명세 6.7
    """

    async def scenario(h: Harness) -> None:
        h.join(55, 56)
        session = await h.answer(1, session_id=55, seq=1)
        session.speak()
        await until(lambda: len(h.delivered) == 1)
        h.info(4, "DECIDING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
        h.info(5, "ASKING", session_id=55, seq=2, kind="FOLLOWUP", base=None)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 2)

    h = run_with_judge(scenario, FOLLOWUP)
    assert h.followups is not None and h.followups.calls == [("자기소개", "답변")]
    decided = h.results(ResultType.FOLLOWUP_DECIDED)[0]
    assert (decided["needed"], decided["content"], decided["promptVersion"]) == (
        True,
        FOLLOWUP.content,
        "group-followup-v1",
    )
    assert decided["turnVersion"] == 4
    assert decided["generationMs"] is not None
    assert h.voice.played[-1] == FOLLOWUP.content
    started = h.results(ResultType.QUESTION_STARTED)[-1]
    assert (started["seq"], started["kind"], started["content"], started["modelVersion"]) == (
        2,
        "FOLLOWUP",
        FOLLOWUP.content,
        "gms-model",
    )


def test_chat_followup_waits_for_final_answer_from_be() -> None:
    """채팅은 BE가 보낸 group.answer의 글로 판단한다. 작성 중인 글로는 판단하지 않는다."""

    async def scenario(h: Harness) -> None:
        h.join(55)
        h.info(1, "ASKING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)
        h.info(2, "DECIDING", session_id=55, seq=1)
        await asyncio.sleep(0.05)
        assert h.results(ResultType.FOLLOWUP_DECIDED) == []
        assert h.runner is not None
        h.runner.group_answer_received(group_answer(55, 1, "최종 답변"))
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
        # 같은 답변 글을 다시 받으면 처음 판단을 다시 보낸다
        h.runner.group_answer_received(group_answer(55, 1, "다른 글"))
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 2)

    h = run_with_judge(scenario, None, mode="CHAT")
    assert h.followups is not None and h.followups.calls == [("자기소개", "최종 답변")]
    first, again = h.results(ResultType.FOLLOWUP_DECIDED)
    assert first == again
    assert first["needed"] is False


@pytest.mark.parametrize(
    "payload",
    [
        "{broken",
        json.dumps({"sessionId": 55, "seq": 7, "content": "답"}),
        json.dumps({"sessionId": "55", "seq": 1, "content": "답"}),
        json.dumps({"sessionId": 55, "seq": 1, "content": " "}),
    ],
)
def test_wrong_group_answer_is_ignored(payload: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(group_interview, "DECISION_SECONDS", 0.1)

    async def scenario(h: Harness) -> None:
        h.join(55)
        h.info(1, "ASKING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 1)
        assert h.runner is not None
        h.runner.group_answer_received(payload)
        h.info(2, "DECIDING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)

    h = run_with_judge(scenario, FOLLOWUP, mode="CHAT")
    # 최종 답변을 받지 못해 판단하지 못했으므로 필요 없음이다
    assert h.followups is not None and h.followups.calls == []
    assert h.results(ResultType.FOLLOWUP_DECIDED)[0]["needed"] is False


@pytest.mark.parametrize("outcome", [FollowupError("GMS 실패"), None])
def test_failed_or_unneeded_judgment_reports_not_needed(outcome: Exception | None) -> None:
    async def scenario(h: Harness) -> None:
        h.join(55)
        session = await h.answer(1, session_id=55, seq=1)
        session.speak()
        await until(lambda: len(h.delivered) == 1)
        h.info(4, "DECIDING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)

    h = run_with_judge(scenario, outcome)
    decided = h.results(ResultType.FOLLOWUP_DECIDED)[0]
    assert (decided["needed"], decided["content"]) == (False, None)


def test_followup_is_discarded_when_another_turn_comes() -> None:
    """만든 꼬리질문은 그 사람의 FOLLOWUP 차례가 아닌 차례가 오면 버린다(AI 명세 6.7)."""

    async def scenario(h: Harness) -> None:
        h.join(55, 56)
        session = await h.answer(1, session_id=55, seq=1)
        session.speak()
        await until(lambda: len(h.delivered) == 1)
        h.info(4, "DECIDING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
        h.info(5, "ASKING", session_id=56, seq=1, announce="CALL")
        await until(lambda: len(h.results(ResultType.QUESTION_SPOKEN)) == 2)
        h.info(6, "ASKING", session_id=55, seq=2, kind="FOLLOWUP", base=None)
        await asyncio.sleep(0.05)

    h = run_with_judge(scenario, FOLLOWUP)
    assert FOLLOWUP.content not in h.voice.played
    assert len(h.results(ResultType.QUESTION_STARTED)) == 2


def test_followup_of_followup_uses_asked_followup_as_previous_question() -> None:
    async def scenario(h: Harness) -> None:
        h.join(55)
        session = await h.answer(1, session_id=55, seq=1)
        session.speak()
        await until(lambda: len(h.delivered) == 1)
        h.info(4, "DECIDING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
        followup = await h.answer(5, session_id=55, seq=2, kind="FOLLOWUP", base=None)
        followup.speak()
        followup.speak()
        await until(lambda: len(h.delivered) == 2)
        h.info(8, "DECIDING", session_id=55, seq=2)
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 2)

    h = run_with_judge(scenario, FOLLOWUP)
    assert h.followups is not None
    assert h.followups.calls == [("자기소개", "답변"), (FOLLOWUP.content, "답변답변")]


def test_without_judge_reports_not_needed_at_once() -> None:
    async def scenario(h: Harness) -> None:
        h.info(4, "DECIDING", session_id=55, seq=1)
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)

    h = run(scenario)
    decided = h.results(ResultType.FOLLOWUP_DECIDED)[0]
    assert (decided["needed"], decided["generationMs"]) == (False, None)


def test_late_judgment_does_not_hold_followup() -> None:
    """판단이 늦어 BE가 이미 다음 차례로 넘어갔으면 그 꼬리질문은 들고 있지 않는다."""

    class SlowJudge(FakeJudge):
        def __init__(self) -> None:
            super().__init__(FOLLOWUP)
            self.release = asyncio.Event()

        async def judge(
            self, persona: Any, question: AssignedQuestion, answer: str
        ) -> AssignedQuestion | None:
            await self.release.wait()
            return await super().judge(persona, question, answer)

    async def main() -> Harness:
        h = Harness()
        judge = SlowJudge()
        h.followups = judge
        h.start()
        try:
            h.join(55, 56)
            session = await h.answer(1, session_id=55, seq=1)
            session.speak()
            await until(lambda: len(h.delivered) == 1)
            h.info(4, "DECIDING", session_id=55, seq=1)
            await asyncio.sleep(0.02)
            h.info(5, "ASKING", session_id=56, seq=1, announce="CALL")
            judge.release.set()
            await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
            await asyncio.sleep(0.02)
        finally:
            assert h.running is not None
            h.running.cancel()
            await asyncio.gather(h.running, return_exceptions=True)
        return h

    h = asyncio.run(main())
    assert FOLLOWUP.content not in h.voice.prepared


def test_decision_arriving_before_answer_wrap_up_still_judges_answer() -> None:
    """BE가 답변을 저장해 DECIDING이 와도 답변 작업의 마무리(판단 재료 저장)는 끊지 않는다."""

    async def scenario(h: Harness) -> None:
        h.deliver_hold = asyncio.Event()
        h.join(55)
        session = await h.answer(1, session_id=55, seq=1)
        session.speak()
        await until(lambda: len(h.delivered) == 1)
        h.info(4, "DECIDING", session_id=55, seq=1)
        await asyncio.sleep(0.02)
        h.deliver_hold.set()
        await until(lambda: len(h.results(ResultType.FOLLOWUP_DECIDED)) == 1)
        await until(lambda: ("candidate-55", "submitted") in h.states())

    h = run_with_judge(scenario, FOLLOWUP)
    assert h.followups is not None and h.followups.calls == [("자기소개", "답변")]
    assert h.results(ResultType.FOLLOWUP_DECIDED)[0]["needed"] is True
