import json
from typing import Any

import pytest

from app.agent.assignment import MAX_METADATA_BYTES, AssignmentError, parse_assignment
from app.common.session import InterviewMode, Persona


def questions(count: int = 5) -> list[dict[str, Any]]:
    return [
        {"seq": seq, "content": f"{seq}번 질문", "criteria": f"{seq}번 기준"}
        for seq in range(1, count + 1)
    ]


def metadata(**overrides: Any) -> str:
    value: dict[str, Any] = {
        "sessionId": 55,
        "mode": "VIDEO",
        "persona": "DEVIL",
        "currentSeq": 1,
        "questions": questions(),
    }
    value.update(overrides)
    return json.dumps(value, ensure_ascii=False)


def test_be_assignment_is_parsed() -> None:
    assignment = parse_assignment(metadata())
    assert assignment.session_id == 55
    assert assignment.mode is InterviewMode.VIDEO
    assert assignment.persona is Persona.DEVIL
    assert assignment.current_seq == 1
    assert assignment.question(2) == "2번 질문"
    assert assignment.criteria(2) == "2번 기준"


def test_questions_out_of_order_are_parsed_by_seq() -> None:
    assignment = parse_assignment(metadata(questions=questions()[::-1]))
    assert [assignment.question(seq) for seq in range(1, 6)] == [
        f"{seq}번 질문" for seq in range(1, 6)
    ]


def test_missing_question_is_reported_without_content() -> None:
    assignment = parse_assignment(metadata())
    with pytest.raises(AssignmentError, match="6번 질문"):
        assignment.criteria(6)


def test_unknown_fields_are_ignored() -> None:
    assert parse_assignment(metadata(extra={"key": "value"})).session_id == 55


def with_question(**fields: Any) -> list[dict[str, Any]]:
    items = questions()
    items[0] = {**items[0], **fields}
    return items


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
        metadata(questions=["질문"] * 5),
        metadata(questions=questions(4)),
        metadata(questions=[*questions(), {"seq": 1, "content": "질문", "criteria": "기준"}]),
        metadata(questions=with_question(seq=2)),
        metadata(questions=with_question(content=" ")),
        metadata(questions=with_question(seq="1")),
        metadata(questions=with_question(criteria=None)),
        metadata(questions=with_question(criteria="\n")),
        pytest.param("[" * 100_000, id="deeply nested json"),
    ],
)
def test_malformed_assignment_is_rejected(raw: str) -> None:
    with pytest.raises(AssignmentError):
        parse_assignment(raw)


def test_metadata_size_boundary_is_utf8_bytes() -> None:
    base = metadata(padding="")
    room = MAX_METADATA_BYTES - len(base.encode("utf-8"))
    assert parse_assignment(metadata(padding="a" * room)).session_id == 55
    over_ascii = metadata(padding="a" * (room + 1))
    with pytest.raises(AssignmentError, match="바이트"):
        parse_assignment(over_ascii)
    # 한글은 UTF-8 3바이트이므로 글자 수가 아닌 바이트로 센다
    over_korean = metadata(padding="가" * (room // 3 + 1))
    with pytest.raises(AssignmentError, match="바이트"):
        parse_assignment(over_korean)
