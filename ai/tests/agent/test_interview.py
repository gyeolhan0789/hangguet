import asyncio
import json
import threading
from collections.abc import Callable
from datetime import datetime
from typing import Any

import pytest
from livekit import rtc

from app.agent.assignment import AssignedQuestion, Assignment
from app.agent.interview import (
    ANSWER_STATE_METHOD,
    ANSWER_SUBMIT_METHOD,
    EMPTY_ANSWER,
    NOT_ANSWERING,
    AnswerEnd,
    AnswerState,
    InterviewConductor,
    answer_state_payload,
    submitted_seq,
)
from app.agent.stt import SttSettings
from app.common.answer import SpeechToken, VoiceMetrics
from app.common.results import KST, ResultPublishError, ResultType
from app.common.session import InterviewMode, Persona
from app.interview.realtime.answer_end import AUTO_SUBMIT_SILENCE_MS, NO_SPEECH_TIMEOUT_MS
from app.interview.realtime.progress import EndReason

# 기준: AI 명세 6.2 진행 흐름 · 6.3 answerState · answerSubmit · 6.5 실패 처리
# · 사용자 결정(2026-10-26: [답변 완료] 또는 마지막 말 뒤 7초 침묵이면 다음 질문,
#   한마디도 안 했으면 넘어가지 않음)
# LiveKit 방 · 질문 음성 · STT 캡처 · 결과 큐는 대역으로 바꾸고, 시각은 테스트가 직접 진행한다.

STARTED_AT = datetime(2026, 10, 26, 15, 0, 0, 250000, tzinfo=KST)


def assignment(mode: InterviewMode, current_seq: int = 1) -> Assignment:
    return Assignment(
        session_id=55,
        mode=mode,
        persona=Persona.DEVIL,
        current_seq=current_seq,
        questions={seq: AssignedQuestion(f"질문 {seq}", "기준") for seq in range(1, 6)},
    )


class Clock:
    def __init__(self) -> None:
        self.now = 1_000

    def __call__(self) -> int:
        return self.now


async def settle() -> None:
    """대기 중인 작업이 더 진행할 수 없을 때까지 이벤트 루프를 돌린다(실제 시간은 안 기다림)."""
    for _ in range(50):
        await asyncio.sleep(0)


def has_length(items: list[Any], count: int) -> Callable[[], bool]:
    return lambda: len(items) == count


async def until(condition: Callable[[], bool]) -> None:
    """조건이 맞을 때까지 기다린다.

    결과 큐 전송은 별도 스레드에서 끝나므로 이벤트 루프를 돌리는 것만으로는 부족하다.
    """
    async with asyncio.timeout(5):
        while not condition():
            await asyncio.sleep(0.001)


# --- AnswerEnd: 답변 끝 판단 부품을 시각에 맞춰 부르는지 ---


def test_auto_submits_seven_seconds_after_last_speech() -> None:
    async def scenario() -> None:
        clock = Clock()
        states: list[AnswerState] = []
        answer = AnswerEnd(InterviewMode.VIDEO, clock_ms=clock, on_state=states.append)
        waiting = asyncio.create_task(answer.wait())
        answer.speech()
        clock.now += AUTO_SUBMIT_SILENCE_MS - 1
        answer.tick()
        await settle()
        assert not waiting.done()
        # 7초 안에 다시 말하면 처음부터 다시 센다
        answer.speech()
        clock.now += AUTO_SUBMIT_SILENCE_MS
        answer.tick()
        assert await waiting is EndReason.AUTO_SUBMIT
        assert states == [AnswerState.AUTO_SUBMITTED]

    asyncio.run(scenario())


def test_without_speech_times_out_once_and_keeps_listening_until_speech() -> None:
    async def scenario() -> None:
        clock = Clock()
        states: list[AnswerState] = []
        answer = AnswerEnd(InterviewMode.VIDEO, clock_ms=clock, on_state=states.append)
        waiting = asyncio.create_task(answer.wait())
        clock.now += AUTO_SUBMIT_SILENCE_MS * 2
        answer.tick()
        await settle()
        # 한마디도 안 했으면 7초로 넘어가지 않는다
        assert not waiting.done() and states == []

        clock.now += NO_SPEECH_TIMEOUT_MS
        answer.tick()
        clock.now += NO_SPEECH_TIMEOUT_MS
        answer.tick()
        await settle()
        assert states == [AnswerState.TIMED_OUT]
        assert not waiting.done()

        # 그 뒤에 말을 시작하면 7초 규칙으로 끝난다
        answer.speech()
        clock.now += AUTO_SUBMIT_SILENCE_MS
        answer.tick()
        assert await waiting is EndReason.AUTO_SUBMIT

    asyncio.run(scenario())


def test_manual_submit_needs_speech_in_video_but_not_in_chat() -> None:
    async def scenario() -> None:
        video = AnswerEnd(InterviewMode.VIDEO, clock_ms=Clock())
        assert video.request_submit().value == "empty_answer"
        video.speech()
        assert video.request_submit().value == "accept"
        assert video.request_submit().value == "already_submitting"
        assert await video.wait() is EndReason.MANUAL_SUBMIT

        chat = AnswerEnd(InterviewMode.CHAT, clock_ms=Clock())
        assert chat.request_submit().value == "accept"
        assert await chat.wait() is EndReason.MANUAL_SUBMIT

    asyncio.run(scenario())


def test_stt_failure_is_announced_once_and_spoken_answer_can_still_be_submitted() -> None:
    async def scenario() -> None:
        states: list[AnswerState] = []
        answer = AnswerEnd(InterviewMode.VIDEO, clock_ms=Clock(), on_state=states.append)
        answer.speech()
        answer.stt_failed()
        answer.stt_failed()
        assert states == [AnswerState.STT_FAILED]
        assert answer.request_submit().value == "accept"
        assert await answer.wait() is EndReason.MANUAL_SUBMIT

    asyncio.run(scenario())


def test_payload_helpers() -> None:
    assert json.loads(answer_state_payload(55, 2, AnswerState.SUBMITTED)) == {
        "type": "answer.state",
        "sessionId": 55,
        "seq": 2,
        "state": "submitted",
    }
    assert submitted_seq('{"type":"answer.submit","sessionId":55,"seq":3}') == 3
    for payload in ("not json", "[]", '{"seq":"3"}', '{"seq":true}', "{}"):
        assert submitted_seq(payload) is None


# --- InterviewConductor: 질문 진행 ---


class FakeLocalParticipant:
    def __init__(self) -> None:
        self.methods: dict[str, Callable[[rtc.RpcInvocationData], Any]] = {}
        self.rpc: list[tuple[str, str, dict[str, Any]]] = []

    def register_rpc_method(self, name: str, handler: Callable[..., Any]) -> None:
        self.methods[name] = handler

    def unregister_rpc_method(self, name: str) -> None:
        self.methods.pop(name, None)

    async def perform_rpc(
        self, *, destination_identity: str, method: str, payload: str, response_timeout: float
    ) -> str:
        self.rpc.append((destination_identity, method, json.loads(payload)))
        return ""

    def states(self) -> list[tuple[int, str]]:
        return [(p["seq"], p["state"]) for _, m, p in self.rpc if m == ANSWER_STATE_METHOD]


class FakeRoom:
    def __init__(self) -> None:
        self.local_participant = FakeLocalParticipant()
        self.handlers: dict[str, Callable[..., None]] = {}
        self.remote_participants: dict[str, Participant] = {}

    def on(self, event: str, handler: Callable[..., None]) -> None:
        self.handlers[event] = handler

    def off(self, event: str, _handler: Callable[..., None]) -> None:
        self.handlers.pop(event, None)

    def leave(self, identity: str) -> None:
        self.remote_participants.pop(identity, None)
        self.handlers["participant_disconnected"](Participant(identity))


class Participant:
    def __init__(self, identity: str) -> None:
        self.identity = identity


class FakeSpeaker:
    """질문을 말한 기록. hold가 있으면 그 질문은 테스트가 끝낼 때까지 말하는 중이다."""

    def __init__(self) -> None:
        self.asked: list[tuple[int, str, bool]] = []
        self.hold: set[int] = set()
        self.release = asyncio.Event()
        self.cancelled: list[int] = []

    async def publish_track(self) -> None:
        pass

    async def prepare(self, seq: int) -> None:
        return None

    async def ask(self, seq: int, destination: str, audio: object, *, announce: bool) -> None:
        self.asked.append((seq, destination, announce))
        if seq in self.hold:
            try:
                await self.release.wait()
            except asyncio.CancelledError:
                self.cancelled.append(seq)
                raise


class FakeCapture:
    def __init__(self, on_speech: Callable[[], None], on_error: Callable[[], None]) -> None:
        self.started_at = STARTED_AT
        self.on_speech = on_speech
        self.on_error = on_error
        self.content = "조회 쿼리 실행 계획을 봤습니다."
        self.finished = False
        self.discarded = False

    def tokens(self) -> tuple[SpeechToken, ...]:
        return (SpeechToken("조회", 0, 280),)

    async def voice(self, _tokens: object) -> VoiceMetrics:
        return VoiceMetrics(trailing_off_ratio=12.5, pitch_range_st=6.2)

    async def finish(self) -> None:
        self.finished = True

    async def discard(self) -> None:
        if not self.finished:
            self.discarded = True


class FakeResults:
    def __init__(self) -> None:
        self.published: list[tuple[ResultType, int, dict[str, Any]]] = []
        self.fail = False
        # 설정하면 테스트가 풀 때까지 결과 큐에 넣는 중이다(별도 스레드에서 기다린다)
        self.hold: threading.Event | None = None
        self.holding = threading.Event()

    def publish(self, result_type: ResultType, session_id: int, fields: dict[str, Any]) -> None:
        if self.hold is not None:
            self.holding.set()
            self.hold.wait(5)
        if self.fail:
            raise ResultPublishError("결과 큐에 넣지 못했다")
        self.published.append((result_type, session_id, dict(fields)))


class Harness:
    def __init__(self, mode: InterviewMode, current_seq: int = 1) -> None:
        self.room = FakeRoom()
        self.speaker = FakeSpeaker()
        self.results = FakeResults()
        self.captures: list[FakeCapture] = []
        self.identity = "candidate"
        self.present = asyncio.Event()
        self.present.set()
        self.closed = False
        # 캡처를 열지 못할 횟수 · 캡처마다 확정될 답변 글
        self.open_fails = 0
        self.contents: list[str] = []
        self.conductor = InterviewConductor(
            self.room,  # type: ignore[arg-type]
            assignment(mode, current_seq),
            self.speaker,  # type: ignore[arg-type]
            self.results,  # type: ignore[arg-type]
            SttSettings(api_key="key"),
            self.wait_participant,  # type: ignore[arg-type]
            clock=lambda: STARTED_AT,
            clock_ms=Clock(),
            capture_factory=self.capture,  # type: ignore[arg-type]
        )

    async def wait_participant(self) -> Participant | None:
        await self.present.wait()
        if self.closed:
            return None
        participant = Participant(self.identity)
        self.room.remote_participants[self.identity] = participant
        return participant

    def capture(
        self, _room: object, _participant: object, _settings: object, **kwargs: Any
    ) -> FakeCapture:
        if self.open_fails:
            self.open_fails -= 1
            raise RuntimeError("음성 스트림을 열지 못했다")
        capture = FakeCapture(kwargs["on_speech"], kwargs["on_error"])
        if self.contents:
            capture.content = self.contents.pop(0)
        self.captures.append(capture)
        return capture

    async def submit(self, seq: int) -> dict[str, Any]:
        handler = self.room.local_participant.methods[ANSWER_SUBMIT_METHOD]
        data = rtc.RpcInvocationData(
            request_id="r",
            caller_identity=self.identity,
            payload=json.dumps({"type": "answer.submit", "sessionId": 55, "seq": seq}),
            response_timeout=3,
        )
        result: dict[str, Any] = json.loads(await handler(data))
        return result

    def completed(self) -> list[dict[str, Any]]:
        return [f for t, _, f in self.results.published if t is ResultType.ANSWER_COMPLETED]


def test_video_asks_each_question_and_moves_on_after_submit_until_the_fifth() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        running = asyncio.create_task(h.conductor.run())
        for seq in range(1, 6):
            await until(has_length(h.captures, seq))
            assert h.speaker.asked[-1] == (seq, "candidate", True)
            h.captures[-1].on_speech()
            assert await h.submit(seq) == {"accepted": True}
        await running

        assert [seq for seq, _, _ in h.speaker.asked] == [1, 2, 3, 4, 5]
        assert all(capture.finished for capture in h.captures)
        assert [answer["seq"] for answer in h.completed()] == [1, 2, 3, 4, 5]
        first = h.completed()[0]
        assert first["endReason"] == "MANUAL_SUBMIT"
        assert first["answerStartedAt"] == "2026-10-26T15:00:00.250+09:00"
        assert first["content"] == "조회 쿼리 실행 계획을 봤습니다."
        assert first["speech"] == {"trailingOffRatio": 12.5, "pitchRangeSt": 6.2}
        assert h.room.local_participant.states() == [(seq, "submitted") for seq in range(1, 6)]
        # 다 진행한 뒤에도 면접방이 닫힐 때까지 지난 질문의 [답변 완료]에 false로 답한다
        assert await h.submit(5) == {"accepted": False}
        h.conductor.aclose()
        assert ANSWER_SUBMIT_METHOD not in h.room.local_participant.methods

    asyncio.run(scenario())


def test_video_starts_from_current_seq_of_reassignment() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO, current_seq=4)
        running = asyncio.create_task(h.conductor.run())
        for count, seq in enumerate((4, 5), start=1):
            await until(has_length(h.captures, count))
            h.captures[-1].on_speech()
            await h.submit(seq)
        await running
        assert [seq for seq, _, _ in h.speaker.asked] == [4, 5]

    asyncio.run(scenario())


def test_video_rejects_submit_while_asking_before_speech_and_for_other_questions() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        h.speaker.hold.add(1)
        running = asyncio.create_task(h.conductor.run())
        await settle()
        # 질문 음성 재생 중
        with pytest.raises(rtc.RpcError) as asking:
            await h.submit(1)
        assert asking.value.code == NOT_ANSWERING

        h.speaker.release.set()
        await settle()
        # 한마디도 안 했으면
        with pytest.raises(rtc.RpcError) as empty:
            await h.submit(1)
        assert empty.value.code == EMPTY_ANSWER
        # 지금 질문이 아니면 무시한다
        assert await h.submit(2) == {"accepted": False}
        assert h.completed() == []
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())


def test_leaving_while_answering_discards_the_answer_and_listens_again_without_asking() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        running = asyncio.create_task(h.conductor.run())
        await settle()
        h.captures[0].on_speech()
        h.present.clear()
        h.room.leave("candidate")
        await settle()
        assert h.captures[0].discarded

        h.identity = "candidate"
        h.present.set()
        await settle()
        assert len(h.captures) == 2
        assert len(h.speaker.asked) == 1
        h.captures[1].on_speech()
        await h.submit(1)
        await until(lambda: len(h.completed()) == 1)
        assert [answer["seq"] for answer in h.completed()] == [1]
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())


def test_leaving_while_asking_repeats_the_question_without_announcing_again() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        h.speaker.hold.add(1)
        running = asyncio.create_task(h.conductor.run())
        await settle()
        h.present.clear()
        h.room.leave("candidate")
        await settle()
        h.speaker.hold.clear()
        h.present.set()
        await settle()
        assert h.speaker.asked == [(1, "candidate", True), (1, "candidate", False)]
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())


def test_failed_delivery_waits_for_retry_then_moves_on() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        h.results.fail = True
        running = asyncio.create_task(h.conductor.run())
        await settle()
        h.captures[0].on_speech()
        await h.submit(1)
        await until(lambda: len(h.room.local_participant.states()) == 1)
        assert h.room.local_participant.states() == [(1, "submitFailed")]
        assert len(h.speaker.asked) == 1

        h.results.fail = False
        assert await h.submit(1) == {"accepted": True}
        await until(lambda: len(h.speaker.asked) == 2)
        assert h.room.local_participant.states() == [(1, "submitFailed"), (1, "submitted")]
        assert [answer["seq"] for answer in h.completed()] == [1]
        assert h.speaker.asked[-1][0] == 2
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())


def test_chat_moves_on_after_submit_even_if_it_arrives_while_asking() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.CHAT)
        h.speaker.hold.add(1)
        running = asyncio.create_task(h.conductor.run())
        await settle()
        # 질문 음성 재생 중에 온 [답변 완료]도 받아 두고, 다 말한 뒤 다음 질문으로 간다
        assert await h.submit(1) == {"accepted": True}
        await settle()
        assert [seq for seq, _, _ in h.speaker.asked] == [1]
        h.speaker.release.set()
        await settle()
        assert [seq for seq, _, _ in h.speaker.asked] == [1, 2]
        # 이미 진행한 질문의 [답변 완료](새로고침 뒤 다시 낸 답변)는 무시한다
        assert await h.submit(1) == {"accepted": False}

        for seq in range(2, 6):
            await until(has_length(h.speaker.asked, seq))
            await h.submit(seq)
        await running
        # 채팅 답변은 화면이 5.7로 내므로 에이전트는 듣지도 내지도 않는다
        assert h.captures == [] and h.completed() == []
        assert h.room.local_participant.states() == []

    asyncio.run(scenario())


def test_stops_when_the_room_closes_while_waiting_for_the_candidate() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        h.closed = True
        await h.conductor.run()
        assert h.speaker.asked == []

    asyncio.run(scenario())


def test_submit_while_delivering_is_not_accepted_twice() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        h.results.hold = threading.Event()
        running = asyncio.create_task(h.conductor.run())
        await settle()
        h.captures[0].on_speech()
        assert await h.submit(1) == {"accepted": True}
        await until(h.results.holding.is_set)
        # 결과 큐에 내는 중이면 이미 제출 중이라 받지 않는다(2002가 아니라 false)
        assert await h.submit(1) == {"accepted": False}
        h.results.hold.set()
        await until(has_length(h.speaker.asked, 2))
        assert [answer["seq"] for answer in h.completed()] == [1]
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())


def test_answer_without_confirmed_text_is_listened_again() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        h.contents = ["   "]
        running = asyncio.create_task(h.conductor.run())
        await settle()
        h.captures[0].on_speech()
        await h.submit(1)
        # 낼 답변이 없으니 질문을 다시 말하지 않고 새 캡처로 다시 듣는다
        await until(has_length(h.captures, 2))
        assert h.completed() == [] and len(h.speaker.asked) == 1
        h.captures[1].on_speech()
        await h.submit(1)
        await until(has_length(h.speaker.asked, 2))
        assert [answer["seq"] for answer in h.completed()] == [1]
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())


def test_capture_open_failure_announces_stt_failure_and_retries_after_rejoin() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        h.open_fails = 1
        running = asyncio.create_task(h.conductor.run())
        await until(lambda: h.room.local_participant.states() == [(1, "sttFailed")])
        assert h.captures == []

        h.present.clear()
        h.room.leave("candidate")
        await settle()
        h.present.set()
        await until(has_length(h.captures, 1))
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())


def test_stt_failure_after_the_answer_ended_is_not_announced() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        h.results.hold = threading.Event()
        running = asyncio.create_task(h.conductor.run())
        await settle()
        h.captures[0].on_speech()
        await h.submit(1)
        await until(h.results.holding.is_set)
        h.captures[0].on_error()
        h.results.hold.set()
        await until(has_length(h.speaker.asked, 2))
        assert h.room.local_participant.states() == [(1, "submitted")]
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())


def test_stt_failure_while_answering_is_announced_and_spoken_answer_can_be_submitted() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        running = asyncio.create_task(h.conductor.run())
        await settle()
        h.captures[0].on_speech()
        h.captures[0].on_error()
        await until(lambda: h.room.local_participant.states() == [(1, "sttFailed")])
        assert await h.submit(1) == {"accepted": True}
        await until(has_length(h.speaker.asked, 2))
        assert [answer["seq"] for answer in h.completed()] == [1]
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())


def test_closing_the_room_stops_the_question_and_discards_the_answer() -> None:
    async def scenario() -> None:
        asking = Harness(InterviewMode.VIDEO)
        asking.speaker.hold.add(1)
        running = asyncio.create_task(asking.conductor.run())
        await settle()
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)
        # 말하던 질문 음성도 멈춘다
        assert asking.speaker.cancelled == [1]

        answering = Harness(InterviewMode.VIDEO)
        running = asyncio.create_task(answering.conductor.run())
        await settle()
        answering.captures[0].on_speech()
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)
        assert answering.captures[0].discarded
        assert answering.completed() == []

    asyncio.run(scenario())


def test_failed_delivery_is_announced_again_after_rejoin() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        h.results.fail = True
        running = asyncio.create_task(h.conductor.run())
        await settle()
        h.captures[0].on_speech()
        await h.submit(1)
        await until(lambda: len(h.room.local_participant.states()) == 1)

        h.present.clear()
        h.room.leave("candidate")
        await settle()
        h.present.set()
        await until(lambda: len(h.room.local_participant.states()) == 2)
        assert h.room.local_participant.states() == [(1, "submitFailed"), (1, "submitFailed")]

        h.results.fail = False
        assert await h.submit(1) == {"accepted": True}
        await until(has_length(h.speaker.asked, 2))
        assert [answer["seq"] for answer in h.completed()] == [1]
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())


def test_candidate_who_left_right_after_being_found_is_waited_for_again() -> None:
    async def scenario() -> None:
        h = Harness(InterviewMode.VIDEO)
        original = h.wait_participant
        returned = 0

        async def leaves_once() -> Participant | None:
            nonlocal returned
            participant = await original()
            returned += 1
            if returned == 1:
                # 찾은 직후, 진행이 다시 실행되기 전에 퇴장한다
                h.room.remote_participants.pop("candidate")
            return participant

        h.conductor._wait_participant = leaves_once  # type: ignore[assignment]
        running = asyncio.create_task(h.conductor.run())
        await settle()
        # 질문 전에 두 번(처음 찾은 지원자는 이미 나갔다), 답변 전에 한 번 기다린다
        assert returned == 3
        assert len(h.speaker.asked) == 1 and len(h.captures) == 1
        running.cancel()
        await asyncio.gather(running, return_exceptions=True)

    asyncio.run(scenario())
