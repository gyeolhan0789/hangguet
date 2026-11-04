import json

import pytest

from app.agent.rejection import rejected_session_id


@pytest.mark.parametrize(
    ("metadata", "room", "expected"),
    [
        pytest.param(json.dumps({"sessionId": 56}), "interview-55", 56, id="metadata first"),
        pytest.param("{broken", "interview-55", 55, id="not json"),
        pytest.param(None, "interview-55", 55, id="no metadata"),
        pytest.param(json.dumps([55]), "interview-55", 55, id="not object"),
        pytest.param(json.dumps({"sessionId": "56"}), "interview-55", 55, id="text session id"),
        pytest.param(json.dumps({"sessionId": 0}), "interview-55", 55, id="zero session id"),
        pytest.param(json.dumps({"sessionId": True}), "interview-55", 55, id="bool session id"),
        pytest.param("[" * 100_000, "interview-55", 55, id="too deep json"),
    ],
)
def test_session_id_comes_from_metadata_then_room_name(
    metadata: str | None, room: str, expected: int
) -> None:
    """배정 정보에서 읽지 못하면 방 이름(interview-{sessionId})에서 읽는다(AI 명세 6.5)."""
    assert rejected_session_id(metadata, room) == expected


@pytest.mark.parametrize(
    "room", ["test-room", "interview-", "interview-abc", "interview-0", "interview-５５", "55"]
)
def test_unknown_session_id_is_none(room: str) -> None:
    """어느 면접인지 알 수 없으면 전송하지 않도록 None이다."""
    assert rejected_session_id("{broken", room) is None
