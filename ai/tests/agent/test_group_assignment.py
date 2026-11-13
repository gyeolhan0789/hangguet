"""그룹 면접 배정 정보 · 배정 거절(AI 명세 6.7)."""

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from app.agent.assignment import (
    Assignment,
    AssignmentError,
    GroupAssignment,
    parse_assignment,
)
from app.agent.main import accept_request
from app.agent.rejection import is_group_room, rejected_group_id, send_group_rejection
from app.common.results import FailureReason, ResultPublishError
from app.common.session import InterviewMode, Persona


def question(content: str) -> dict[str, Any]:
    return {"content": content, "criteria": "기준", "companyItem": None}


def participant(session_id: int, **changes: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "sessionId": session_id,
        "identity": f"candidate-{session_id}",
        "personalQuestions": [question(f"{session_id} 개인1"), question(f"{session_id} 개인2")],
    }
    item.update(changes)
    return item


def group_json(**changes: Any) -> str:
    """AI 명세 6.7 배정 정보 예시와 같은 모양이다."""
    message: dict[str, Any] = {
        "kind": "GROUP",
        "groupId": 12,
        "mode": "VIDEO",
        "persona": "COFFEE_CHAT",
        "commonQuestions": [question("자기소개"), question("인성")],
        "participants": [participant(55), participant(56)],
    }
    message.update(changes)
    return json.dumps(message)


def test_group_assignment_is_parsed_in_answer_order() -> None:
    assignment = parse_assignment(group_json())

    assert isinstance(assignment, GroupAssignment)
    assert assignment.group_id == 12
    assert assignment.mode is InterviewMode.VIDEO
    assert assignment.persona is Persona.COFFEE_CHAT
    assert [q.content for q in assignment.common_questions] == ["자기소개", "인성"]
    assert [p.session_id for p in assignment.participants] == [55, 56]
    assert [q.content for q in assignment.participants[1].personal_questions] == [
        "56 개인1",
        "56 개인2",
    ]
    assert assignment.participant(56) is assignment.participants[1]
    assert assignment.participant(99) is None


def test_company_item_of_personal_question_is_kept() -> None:
    item = {"section": "market", "summary": "시장"}
    people = [
        participant(
            55, personalQuestions=[{**question("개인1"), "companyItem": item}, question("개인2")]
        ),
        participant(56),
    ]

    assignment = parse_assignment(group_json(participants=people))

    assert isinstance(assignment, GroupAssignment)
    assert assignment.participants[0].personal_questions[0].company_item == item


def test_assignment_without_kind_is_individual() -> None:
    """kind가 없으면 6.1의 개인 면접 형식이다."""
    message = {
        "sessionId": 55,
        "mode": "CHAT",
        "persona": "DEVIL",
        "currentSeq": 1,
        "questions": [{"seq": s, "content": "질문", "criteria": "기준"} for s in range(1, 6)],
    }

    assert isinstance(parse_assignment(json.dumps(message)), Assignment)


@pytest.mark.parametrize(
    "changes",
    [
        pytest.param({"kind": "SOLO"}, id="unknown kind"),
        pytest.param({"groupId": 0}, id="zero group id"),
        pytest.param({"commonQuestions": [question("자기소개")]}, id="one common question"),
        pytest.param(
            {"commonQuestions": [question("자기소개"), {"content": " ", "criteria": "기준"}]},
            id="blank common question",
        ),
        pytest.param({"participants": [participant(55)]}, id="one participant"),
        pytest.param(
            {"participants": [participant(s) for s in (55, 56, 57, 58)]}, id="four participants"
        ),
        pytest.param({"participants": [participant(55), participant(55)]}, id="same session"),
        pytest.param(
            {"participants": [participant(55, identity="candidate"), participant(56)]},
            id="identity not of session",
        ),
        pytest.param(
            {
                "participants": [
                    participant(55, personalQuestions=[question("개인1")]),
                    participant(56),
                ]
            },
            id="one personal question",
        ),
        pytest.param({"participants": "55"}, id="participants not list"),
    ],
)
def test_wrong_group_assignment_is_rejected(changes: dict[str, Any]) -> None:
    with pytest.raises(AssignmentError):
        parse_assignment(group_json(**changes))


@pytest.mark.parametrize(
    ("metadata", "room", "group", "group_id"),
    [
        pytest.param(group_json(), "group-12", True, 12, id="metadata"),
        pytest.param(group_json(groupId=13), "group-12", True, 13, id="metadata first"),
        pytest.param("{broken", "group-12", True, 12, id="room name"),
        pytest.param(json.dumps({"kind": "GROUP"}), "other", True, None, id="kind only"),
        pytest.param("{broken", "interview-55", False, None, id="individual room"),
        pytest.param("{broken", "group-abc", True, None, id="unknown group id"),
    ],
)
def test_group_rejection_target_comes_from_metadata_then_room_name(
    metadata: str, room: str, group: bool, group_id: int | None
) -> None:
    assert is_group_room(metadata, room) is group
    assert rejected_group_id(metadata, room) == group_id


def test_wrong_group_assignment_is_reported_to_group_queue() -> None:
    """그룹 배정 거절은 groupId를 담아 그룹 결과 큐로 보낸다(AI 명세 6.7)."""
    request = Mock(accept=AsyncMock(), reject=AsyncMock())
    request.job.metadata = group_json(participants=[participant(55)])
    request.room.name = "group-12"
    results = Mock()
    group = Mock()

    asyncio.run(accept_request(request, results=lambda: results, group=lambda: group))

    request.reject.assert_awaited_once_with(terminate=True)
    group.publish_group_rejection.assert_called_once_with(12, {"reason": "INVALID_ASSIGNMENT"})
    results.publish.assert_not_called()


def test_group_rejection_without_group_id_or_failed_send_does_not_raise() -> None:
    group = Mock()

    asyncio.run(send_group_rejection(group, None, FailureReason.INVALID_ASSIGNMENT))
    group.publish_group_rejection.side_effect = ResultPublishError("전송 실패")
    asyncio.run(send_group_rejection(group, 12, FailureReason.INVALID_ASSIGNMENT))

    group.publish_group_rejection.assert_called_once()
