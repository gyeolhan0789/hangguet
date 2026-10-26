import json
from typing import Any

import pytest
from livekit import rtc

from app.agent.answer_rpc import (
    ANSWER_STATE_METHOD,
    ANSWER_SUBMIT_METHOD,
    AnswerState,
    InvalidAnswerSubmitError,
    answer_state_payload,
    answer_submit_reply,
    parse_answer_submit,
)
from app.interview.realtime.answer_end import Decision

SESSION_ID = 55


def submit(**changes: Any) -> str:
    message: dict[str, Any] = {"type": "answer.submit", "sessionId": SESSION_ID, "seq": 3}
    message.update(changes)
    return json.dumps(message)


def test_method_names_follow_spec() -> None:
    assert (ANSWER_SUBMIT_METHOD, ANSWER_STATE_METHOD) == (
        "interview.answerSubmit",
        "interview.answerState",
    )


def test_parses_seq_of_answer_submit() -> None:
    assert parse_answer_submit(submit(), SESSION_ID) == 3


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param("not json", id="not-json"),
        pytest.param("[1]", id="not-object"),
        pytest.param(submit(type="chat.input"), id="other-type"),
        pytest.param(submit(sessionId=56), id="other-session"),
        pytest.param(submit(sessionId=True), id="session-bool"),
        pytest.param(submit(seq=0), id="seq-zero"),
        pytest.param(submit(seq=6), id="seq-over"),
        pytest.param(submit(seq=True), id="seq-bool"),
        pytest.param(submit(seq="3"), id="seq-text"),
        pytest.param(json.dumps({"type": "answer.submit", "sessionId": SESSION_ID}), id="no-seq"),
    ],
)
def test_rejects_invalid_answer_submit(payload: str) -> None:
    with pytest.raises(InvalidAnswerSubmitError):
        parse_answer_submit(payload, SESSION_ID)


def test_accepted_replies() -> None:
    assert json.loads(answer_submit_reply(Decision.ACCEPT)) == {"accepted": True}
    assert json.loads(answer_submit_reply(Decision.ALREADY_SUBMITTING)) == {"accepted": False}


@pytest.mark.parametrize(
    ("decision", "code"),
    [(Decision.EMPTY_ANSWER, 2001), (Decision.NOT_ANSWERING, 2002)],
)
def test_rejections_are_rpc_errors_with_spec_codes(decision: Decision, code: int) -> None:
    with pytest.raises(rtc.RpcError) as raised:
        answer_submit_reply(decision)
    assert raised.value.code == code


@pytest.mark.parametrize("decision", [Decision.SUBMIT, Decision.TIMEOUT, Decision.WAIT])
def test_timer_decisions_are_not_submit_replies(decision: Decision) -> None:
    with pytest.raises(ValueError):
        answer_submit_reply(decision)


def test_answer_state_payload_has_common_fields() -> None:
    payload = answer_state_payload(SESSION_ID, 2, AnswerState.TIMED_OUT)
    assert json.loads(payload) == {
        "type": "answer.state",
        "sessionId": SESSION_ID,
        "seq": 2,
        "state": "timedOut",
    }


def test_answer_states_follow_spec() -> None:
    assert [state.value for state in AnswerState] == [
        "autoSubmitted",
        "timedOut",
        "sttReconnecting",
        "sttFailed",
        "submitted",
        "submitFailed",
    ]
