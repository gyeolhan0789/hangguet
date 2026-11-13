import json
from typing import Any

import pytest
from livekit import rtc

from app.agent.answer_rpc import (
    ANSWER_STATE_METHOD,
    ANSWER_SUBMIT_METHOD,
    MAX_SUBMIT_CONTENT_LENGTH,
    AnswerState,
    AnswerSubmit,
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
    assert parse_answer_submit(submit(), SESSION_ID) == AnswerSubmit(3, None)


# 기준: AI 명세 6.3 interview.answerSubmit content(채팅만, 1,000자 이하, 화상은 null)
def test_parses_chat_answer_content_up_to_limit() -> None:
    content = "가" * MAX_SUBMIT_CONTENT_LENGTH
    assert parse_answer_submit(submit(content=content), SESSION_ID) == AnswerSubmit(3, content)
    assert parse_answer_submit(submit(content=None), SESSION_ID) == AnswerSubmit(3, None)


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
        pytest.param(submit(content=1), id="content-number"),
        pytest.param(submit(content=["답변"]), id="content-list"),
        pytest.param(submit(content="가" * 1001), id="content-over"),
    ],
)
def test_rejects_invalid_answer_submit(payload: str) -> None:
    with pytest.raises(InvalidAnswerSubmitError):
        parse_answer_submit(payload, SESSION_ID)


def test_bool_session_id_is_rejected_for_session_one() -> None:
    payload = json.dumps({"type": "answer.submit", "sessionId": True, "seq": 3})
    with pytest.raises(InvalidAnswerSubmitError):
        parse_answer_submit(payload, 1)


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


def test_group_answer_submit_accepts_seq_up_to_six() -> None:
    """그룹 면접 질문 번호는 1~6이다(AI 명세 6.7). 개인 면접은 그대로 1~5다."""
    assert parse_answer_submit(submit(seq=6), SESSION_ID, max_seq=6) == AnswerSubmit(6, None)
    with pytest.raises(InvalidAnswerSubmitError):
        parse_answer_submit(submit(seq=6), SESSION_ID)
    with pytest.raises(InvalidAnswerSubmitError):
        parse_answer_submit(submit(seq=7), SESSION_ID, max_seq=6)
