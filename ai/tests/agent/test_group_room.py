"""그룹 면접방 정보 읽기(AI 명세 6.7, API 명세 10.11)."""

import json
from datetime import datetime, timedelta
from typing import Any

import pytest

from app.agent.group_room import (
    Announce,
    GroupPhase,
    RoomInfoError,
    RoomInfoTracker,
    TurnKind,
    parse_room_info,
)
from app.common.results import KST

SERVER_TIME = datetime(2026, 11, 4, 14, 3, 0, 120000, tzinfo=KST)


def room_json(version: int = 17, **changes: Any) -> str:
    """API 명세 10.11 예시와 같은 모양이다."""
    message: dict[str, Any] = {
        "turnVersion": version,
        "serverTime": SERVER_TIME.isoformat(),
        "groupStatus": "IN_PROGRESS",
        "round": 2,
        "phase": "ANSWERING",
        "turn": {
            "sessionId": 55,
            "seq": 3,
            "kind": "PERSONAL",
            "baseIndex": 2,
            "announce": "FULL",
            "deadlineAt": "2026-11-04T14:05:02.000+09:00",
            "extended": False,
            "followupsLeft": 2,
        },
        "participants": [
            {"sessionId": 55, "turnOrder": 1, "state": "PRESENT", "absentUntil": None},
            {"sessionId": 56, "turnOrder": 2, "state": "DONE", "absentUntil": None},
        ],
        "upcoming": [56],
    }
    message.update(changes)
    return json.dumps(message)


def test_room_info_is_parsed() -> None:
    info = parse_room_info(room_json())

    assert info.turn_version == 17
    assert info.phase is GroupPhase.ANSWERING
    assert info.turn is not None
    assert (info.turn.session_id, info.turn.seq) == (55, 3)
    assert info.turn.kind is TurnKind.PERSONAL
    assert info.turn.base_index == 2
    assert info.turn.announce is Announce.FULL
    assert info.turn.deadline_at == datetime(2026, 11, 4, 14, 5, 2, tzinfo=KST)
    assert info.participant_state(56) == "DONE"
    assert info.participant_state(99) is None


def test_no_remaining_question_has_null_phase_and_turn() -> None:
    """남은 질문이 없으면 phase · turn은 null이다(API 명세 10.11)."""
    info = parse_room_info(room_json(phase=None, turn=None, upcoming=[]))

    assert info.phase is None
    assert info.turn is None


@pytest.mark.parametrize(
    "metadata",
    [
        "{broken",
        "[]",
        room_json(turnVersion="17"),
        room_json(phase="UNKNOWN"),
        room_json(serverTime="2026-11-04T14:03:00"),
        room_json(participants=None),
    ],
)
def test_wrong_room_info_is_error(metadata: str) -> None:
    with pytest.raises(RoomInfoError):
        parse_room_info(metadata)


def test_tracker_keeps_only_newer_version() -> None:
    """가진 것보다 작거나 같은 버전은 버린다. BE가 같은 정보를 다시 보낼 때도 같다."""
    tracker = RoomInfoTracker(clock=lambda: SERVER_TIME)

    assert tracker.update(room_json(17)) is not None
    assert tracker.update(room_json(17)) is None
    assert tracker.update(room_json(16)) is None
    assert tracker.update("{broken") is None
    assert tracker.update("") is None
    newer = tracker.update(room_json(18))

    assert newer is not None and tracker.latest is newer


def test_server_time_is_moved_to_agent_clock() -> None:
    """에이전트 시계가 BE보다 2초 늦으면 마감도 2초 이르게 본다."""
    tracker = RoomInfoTracker(clock=lambda: SERVER_TIME - timedelta(seconds=2))
    tracker.update(room_json())

    deadline = datetime(2026, 11, 4, 14, 5, 2, tzinfo=KST)

    assert tracker.local(deadline) == deadline - timedelta(seconds=2)
