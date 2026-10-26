"""면접방 메시지 중 [답변 완료](answer.submit)와 답변 상태(answer.state)의 형식이다.

기준: AI 명세 6.3 면접방 메시지 형식, API 명세 면접방 메시지.
- RPC 본문에는 공통 필드 type(메시지 이름)과 sessionId를 담는다.
- [답변 완료]의 응답은 받으면 accepted true, 이미 제출 중이면 false이고,
  발화가 없으면 2001 EMPTY_ANSWER, 답변 중이 아니면 2002 NOT_ANSWERING 오류다.
- 판단은 app.interview.realtime.answer_end가 하고, 이 모듈은 그 결정을 메시지로 변환한다.
"""

import json
from enum import IntEnum, StrEnum
from typing import Any

from livekit import rtc

from app.common.session import MAX_SEQ, MIN_SEQ
from app.interview.realtime.answer_end import Decision

ANSWER_SUBMIT_METHOD = "interview.answerSubmit"
ANSWER_STATE_METHOD = "interview.answerState"


class AnswerState(StrEnum):
    """answer.state의 state 값(AI 명세 6.3)."""

    AUTO_SUBMITTED = "autoSubmitted"
    TIMED_OUT = "timedOut"
    STT_RECONNECTING = "sttReconnecting"
    STT_FAILED = "sttFailed"
    SUBMITTED = "submitted"
    SUBMIT_FAILED = "submitFailed"


class AnswerSubmitError(IntEnum):
    """[답변 완료] 거절 RPC 오류 코드(AI 명세 6.3).

    1001~1999는 LiveKit이 예약한 범위다.
    """

    EMPTY_ANSWER = 2001
    NOT_ANSWERING = 2002


class InvalidAnswerSubmitError(ValueError):
    """[답변 완료] 본문 형식이 틀렸다."""


def parse_answer_submit(payload: str, session_id: int) -> int:
    """[답변 완료] 본문의 질문 순서(seq)를 반환한다.

    다른 면접의 메시지이거나 형식이 틀리면 InvalidAnswerSubmitError를 발생시킨다.
    """
    try:
        message = json.loads(payload)
    except json.JSONDecodeError as e:
        raise InvalidAnswerSubmitError("JSON이 아니다") from e
    if not isinstance(message, dict):
        raise InvalidAnswerSubmitError("JSON 객체가 아니다")
    if message.get("type") != "answer.submit":
        raise InvalidAnswerSubmitError("type이 answer.submit이 아니다")
    if message.get("sessionId") != session_id or isinstance(message.get("sessionId"), bool):
        raise InvalidAnswerSubmitError("다른 면접의 메시지다")
    seq = message.get("seq")
    # bool은 int에 속하므로 true를 질문 순서 1로 허용하지 않도록 형식을 비교한다.
    if type(seq) is not int or not MIN_SEQ <= seq <= MAX_SEQ:
        raise InvalidAnswerSubmitError(f"seq는 {MIN_SEQ}~{MAX_SEQ}의 정수여야 한다")
    return seq


def answer_submit_reply(decision: Decision) -> str:
    """답변 끝 판단의 결정을 [답변 완료] 응답으로 변환한다.

    거절 결정은 RPC 오류로 발생시켜 화면이 오류 코드로 처리를 나누게 한다.
    """
    if decision is Decision.ACCEPT:
        return _dumps({"accepted": True})
    if decision is Decision.ALREADY_SUBMITTING:
        return _dumps({"accepted": False})
    if decision is Decision.EMPTY_ANSWER:
        raise rtc.RpcError(AnswerSubmitError.EMPTY_ANSWER, "EMPTY_ANSWER")
    if decision is Decision.NOT_ANSWERING:
        raise rtc.RpcError(AnswerSubmitError.NOT_ANSWERING, "NOT_ANSWERING")
    raise ValueError(f"[답변 완료]의 결정이 아니다: {decision}")


def answer_state_payload(session_id: int, seq: int, state: AnswerState) -> str:
    return _dumps({"type": "answer.state", "sessionId": session_id, "seq": seq, "state": state})


def _dumps(message: dict[str, Any]) -> str:
    return json.dumps(message, ensure_ascii=False, separators=(",", ":"))
