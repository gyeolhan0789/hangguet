"""답변 종료 판단 테스트.

시각은 답변 시작을 0으로 한 밀리초다.
타이머 대신 Tick(now)으로 시간을 전달한다.
"""

from collections.abc import Sequence

from app.common.session import InterviewMode
from app.interview.realtime.answer_end import (
    AUTO_SUBMIT_SILENCE_MS,
    INITIAL_STATE,
    NO_SPEECH_TIMEOUT_MS,
    AnswerEndEvent,
    AnswerEndState,
    AnswerStarted,
    Decision,
    Phase,
    Reconnected,
    Reconnecting,
    Speech,
    SttError,
    SubmitRequested,
    Tick,
    next_answer_end,
    next_deadline,
)
from app.interview.realtime.transcript import Transcript
from tests.interview.realtime.replay import load_responses

START = AnswerStarted(0, InterviewMode.VIDEO)
CHAT = AnswerStarted(0, InterviewMode.CHAT)


def run(
    events: Sequence[object], start: AnswerEndState = INITIAL_STATE
) -> tuple[AnswerEndState, list[str]]:
    """이벤트를 차례로 반영하고 마지막 상태와 Tick마다의 결정을 반환한다."""
    state = start
    decisions: list[str] = []
    for event in events:
        assert isinstance(event, AnswerEndEvent)
        step = next_answer_end(state, event)
        state = step.state
        if isinstance(event, Tick):
            decisions.append(step.decision.value)
    return state, decisions


def test_constants_follow_spec_temporary_values() -> None:
    assert AUTO_SUBMIT_SILENCE_MS == 7_000
    assert NO_SPEECH_TIMEOUT_MS == 60_000


# 7초 자동 제출


def test_does_not_submit_before_speech() -> None:
    assert run([START, Tick(7_000), Tick(30_000)])[1] == ["wait", "wait"]


def test_submits_exactly_seven_seconds_after_last_speech() -> None:
    state, decisions = run([START, Speech(1_000), Tick(7_999), Tick(8_000)])
    assert decisions == ["wait", "submit"]
    assert state.phase is Phase.SUBMITTING


def test_speech_within_seven_seconds_restarts_count() -> None:
    events = [START, Speech(1_000), Speech(5_000), Tick(8_000), Tick(12_000)]
    assert run(events)[1] == ["wait", "submit"]


def test_reconnecting_pauses_seven_seconds_and_resumes_after_reconnect() -> None:
    events = [
        START,
        Speech(1_000),
        Reconnecting(),
        Tick(8_000),
        Tick(20_000),
        Reconnected(20_000),
        Tick(26_999),
        Tick(27_000),
    ]
    assert run(events)[1] == ["wait", "wait", "wait", "submit"]


def test_reconnect_before_speech_does_not_set_seven_seconds() -> None:
    events = [START, Reconnecting(), Reconnected(2_000), Tick(9_000), Tick(30_000)]
    assert run(events)[1] == ["wait", "wait"]


def test_speech_during_reconnect_only_records_spoke() -> None:
    state, _ = run([START, Reconnecting(), Speech(3_000)])
    assert state == AnswerEndState(
        phase=Phase.RECONNECTING, spoke=True, listen_started_at=0, silence_started_at=None
    )
    events = [
        START,
        Reconnecting(),
        Speech(3_000),
        Tick(10_000),
        Reconnected(12_000),
        Tick(18_999),
        Tick(19_000),
        Tick(70_000),
    ]
    assert run(events)[1] == ["wait", "wait", "submit", "wait"]


def test_does_not_submit_after_stt_error() -> None:
    state, decisions = run([START, Speech(1_000), SttError(), Tick(8_000)])
    assert decisions == ["wait"]
    assert state.phase is Phase.ERROR


def test_duplicate_submit_proceeds_once() -> None:
    submitting, decisions = run([START, Speech(1_000), Tick(8_000)])
    assert decisions == ["submit"]
    # 자동 제출 뒤 [답변 완료]는 받지 않고, 다음 Tick도 상태를 변경하지 않는다
    step = next_answer_end(submitting, SubmitRequested())
    assert step.decision is Decision.ALREADY_SUBMITTING
    assert step.state == submitting
    after, after_decisions = run([Tick(20_000)], submitting)
    assert after == submitting
    assert after_decisions == ["wait"]


def test_manual_submit_stops_auto_submit() -> None:
    state, decisions = run([START, Speech(1_000), SubmitRequested(), Tick(8_000)])
    assert decisions == ["wait"]
    assert state.phase is Phase.SUBMITTING


# 60초 timedOut


def test_ends_after_sixty_seconds_without_speech() -> None:
    state, decisions = run([START, Tick(59_999), Tick(60_000)])
    assert decisions == ["wait", "timeout"]
    assert state.phase is Phase.ENDED


def test_does_not_end_after_speech_started() -> None:
    assert run([START, Speech(50_000), Reconnecting(), Tick(70_000)])[1] == ["wait"]


def test_automatic_reconnect_keeps_sixty_second_count() -> None:
    events = [START, Reconnecting(), Tick(40_000), Reconnected(45_000), Tick(60_000)]
    assert run(events)[1] == ["wait", "timeout"]


def test_ends_during_reconnect_at_sixty_seconds() -> None:
    assert run([START, Reconnecting(), Tick(60_000)])[1] == ["timeout"]


def test_stt_error_without_speech_ends_after_sixty_seconds() -> None:
    # 발화가 없으면 [답변 완료]로 끝낼 수 없으므로 오류 상태에서도 60초로 끝낸다
    state, decisions = run([START, SttError(), Tick(59_999), Tick(60_000)])
    assert decisions == ["wait", "timeout"]
    assert state.phase is Phase.ENDED


def test_stt_error_after_speech_does_not_end_or_submit() -> None:
    # 발화가 있었으면 [답변 완료]로 제출할 수 있으므로 시간으로 끝내지 않는다
    state, decisions = run([START, Speech(1_000), SttError(), Tick(8_000), Tick(70_000)])
    assert decisions == ["wait", "wait"]
    assert state.phase is Phase.ERROR


# 의미 없는 이벤트

IGNORED: list[AnswerEndEvent] = [
    Speech(1_000),
    Reconnecting(),
    Reconnected(1_000),
    SubmitRequested(),
    SttError(),
]


def test_meaningless_events_do_not_change_state() -> None:
    assert run(IGNORED)[0] == INITIAL_STATE
    ended, _ = run([START, Tick(60_000)])
    assert run(IGNORED, ended)[0] == ended


def test_answer_started_after_end_restarts_count() -> None:
    ended, _ = run([START, Tick(60_000)])
    events = [AnswerStarted(70_000, InterviewMode.VIDEO), Tick(129_999), Tick(130_000)]
    state, decisions = run(events, ended)
    assert decisions == ["wait", "timeout"]
    assert state.phase is Phase.ENDED


def test_reconnecting_is_ignored_in_error() -> None:
    events = [START, SttError(), Reconnecting(), Reconnected(1_000)]
    assert run(events)[0] == AnswerEndState(phase=Phase.ERROR, listen_started_at=0)


def test_answer_started_resets_spoke() -> None:
    events = [
        START,
        Speech(1_000),
        Tick(8_000),
        AnswerStarted(10_000, InterviewMode.VIDEO),
        Tick(70_000),
    ]
    assert run(events)[1] == ["submit", "timeout"]


def test_stt_error_clears_seven_second_count() -> None:
    assert run([START, Speech(1_000), SttError()])[0] == AnswerEndState(
        phase=Phase.ERROR, spoke=True, listen_started_at=0, silence_started_at=None
    )


def test_submit_request_clears_seven_second_count() -> None:
    state, _ = run([START, Speech(1_000), SubmitRequested()])
    assert state.phase is Phase.SUBMITTING
    assert state.silence_started_at is None


# [답변 완료] 응답(AI 명세 6.3 answerSubmit, RPC 오류 2001·2002)


def submit(events: Sequence[object]) -> tuple[AnswerEndState, AnswerEndState, Decision]:
    """이벤트를 반영한 뒤 [답변 완료]를 받았을 때의 앞뒤 상태와 결정을 반환한다."""
    before, _ = run(events)
    step = next_answer_end(before, SubmitRequested())
    return before, step.state, step.decision


def test_submit_after_speech_is_accepted() -> None:
    _, after, decision = submit([START, Speech(1_000)])
    assert decision is Decision.ACCEPT
    assert after.phase is Phase.SUBMITTING


def test_submit_before_speech_is_empty_answer() -> None:
    before, after, decision = submit([START, Tick(5_000)])
    assert decision is Decision.EMPTY_ANSWER
    assert after == before


def test_submit_before_answer_started_is_not_answering() -> None:
    before, after, decision = submit([])
    assert decision is Decision.NOT_ANSWERING
    assert after == before


def test_submit_after_timeout_is_not_answering() -> None:
    before, after, decision = submit([START, Tick(60_000)])
    assert decision is Decision.NOT_ANSWERING
    assert after == before


def test_submit_during_reconnect_after_speech_is_accepted() -> None:
    _, after, decision = submit([START, Speech(1_000), Reconnecting()])
    assert decision is Decision.ACCEPT
    assert after.phase is Phase.SUBMITTING


def test_submit_after_stt_error_with_speech_is_accepted() -> None:
    # STT 오류는 지원자가 일으킨 것이 아니므로 그때까지 인식된 글을 폐기하지 않고 제출한다
    _, after, decision = submit([START, Speech(1_000), SttError()])
    assert decision is Decision.ACCEPT
    assert after.phase is Phase.SUBMITTING


def test_submit_after_stt_error_without_speech_is_empty_answer() -> None:
    before, after, decision = submit([START, SttError()])
    assert decision is Decision.EMPTY_ANSWER
    assert after == before


# 경계와 실제 응답


def test_boundaries_from_speech_and_answer_start() -> None:
    assert run([START, Speech(0), Tick(6_999), Tick(7_000)])[1] == ["wait", "submit"]
    assert run([START, Tick(59_999), Tick(60_000)])[1] == ["wait", "timeout"]


def test_real_soniox_responses_submit_seven_seconds_after_last_speech() -> None:
    transcript = Transcript()
    transcript.begin_connection(0)
    state = next_answer_end(INITIAL_STATE, START).state
    last_speech_end: float | None = None
    last_speech_at = 0
    decisions: list[str] = []
    for response in load_responses():
        transcript.apply(response.tokens)
        speech_end = transcript.speech_end_ms
        if speech_end is not None and speech_end != last_speech_end:
            last_speech_end = speech_end
            last_speech_at = response.received_ms
            state = next_answer_end(state, Speech(response.received_ms)).state
        step = next_answer_end(state, Tick(response.received_ms))
        state = step.state
        decisions.append(step.decision.value)

    # 문장 사이 1.5초와 끝의 3초 침묵으로는 제출하지 않는다
    assert set(decisions) == {"wait"}
    assert next_answer_end(state, Tick(last_speech_at + 6_999)).decision.value == "wait"
    assert next_answer_end(state, Tick(last_speech_at + 7_000)).decision.value == "submit"


# 채팅(AI 명세 6.2 채팅)


def test_chat_submit_is_accepted_without_speech() -> None:
    # 채팅 답변은 화면이 답변 제출 API(5.7)로 저장한 뒤 [답변 완료]를 보낸다
    _, after, decision = submit([CHAT])
    assert decision is Decision.ACCEPT
    assert after.phase is Phase.SUBMITTING


def test_chat_has_no_seven_or_sixty_second_count() -> None:
    state, decisions = run([CHAT, Speech(1_000), Tick(8_000), Tick(60_000), Tick(600_000)])
    assert decisions == ["wait", "wait", "wait"]
    assert state == AnswerEndState(
        phase=Phase.LISTENING, mode=InterviewMode.CHAT, listen_started_at=0
    )
    assert next_deadline(state) is None


def test_chat_ignores_stt_events() -> None:
    events = [CHAT, Reconnecting(), Reconnected(1_000), SttError()]
    assert run(events)[0].phase is Phase.LISTENING


# 다음 시한(next_deadline)


def test_deadline_before_speech_is_sixty_seconds_from_answer_start() -> None:
    assert next_deadline(run([AnswerStarted(1_000, InterviewMode.VIDEO)])[0]) == 61_000


def test_deadline_after_speech_is_seven_seconds_from_last_speech() -> None:
    assert next_deadline(run([START, Speech(3_000)])[0]) == 10_000
    assert next_deadline(run([START, Speech(3_000), Speech(5_000)])[0]) == 12_000


def test_deadline_during_reconnect_keeps_only_sixty_seconds() -> None:
    assert next_deadline(run([START, Reconnecting()])[0]) == 60_000
    assert next_deadline(run([START, Speech(1_000), Reconnecting()])[0]) is None


def test_deadline_after_stt_error() -> None:
    assert next_deadline(run([START, SttError()])[0]) == 60_000
    assert next_deadline(run([START, Speech(1_000), SttError()])[0]) is None


def test_no_deadline_before_answer_or_after_end() -> None:
    assert next_deadline(INITIAL_STATE) is None
    assert next_deadline(run([START, Speech(1_000), Tick(8_000)])[0]) is None
    assert next_deadline(run([START, Tick(60_000)])[0]) is None


def test_tick_at_deadline_makes_decision() -> None:
    state, _ = run([START, Speech(2_000)])
    deadline = next_deadline(state)
    assert deadline is not None
    assert next_answer_end(state, Tick(deadline - 1)).decision is Decision.WAIT
    assert next_answer_end(state, Tick(deadline)).decision is Decision.SUBMIT
