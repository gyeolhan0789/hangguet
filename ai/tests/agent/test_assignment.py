import json
from typing import Any

import pytest

from app.agent.assignment import AssignmentError, parse_assignment
from app.common.session import InterviewMode, Persona


def metadata(**overrides: Any) -> str:
    value: dict[str, Any] = {
        "sessionId": 55,
        "mode": "VIDEO",
        "persona": "DEVIL",
        "currentSeq": 1,
        "questions": [
            {"seq": 1, "content": "응답 시간을 40% 줄인 과정은?", "criteria": "원인 분석"},
            {"seq": 2, "content": "두 번째 질문", "criteria": "근거"},
        ],
    }
    value.update(overrides)
    return json.dumps(value, ensure_ascii=False)


def test_be_assignment_is_parsed() -> None:
    assignment = parse_assignment(metadata())
    assert assignment.session_id == 55
    assert assignment.mode is InterviewMode.VIDEO
    assert assignment.persona is Persona.DEVIL
    assert assignment.current_seq == 1
    assert assignment.question(2) == "두 번째 질문"


def test_missing_question_is_reported_without_content() -> None:
    with pytest.raises(AssignmentError, match="3번 질문"):
        parse_assignment(metadata()).question(3)


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "[]",
        metadata(mode="PHONE"),
        metadata(persona=None),
        metadata(sessionId=0),
        metadata(sessionId=True),
        metadata(currentSeq=6),
        metadata(questions=None),
        metadata(questions=["질문"]),
        metadata(questions=[{"seq": 1, "content": " "}]),
        metadata(questions=[{"seq": "1", "content": "질문"}]),
    ],
)
def test_malformed_assignment_is_rejected(raw: str) -> None:
    with pytest.raises(AssignmentError):
        parse_assignment(raw)
