"""배정을 거절하면 BE에 assignment.rejected를 전송한다(AI 명세 1.4·6.5).

- BE는 이 메시지를 수신해야 면접방을 닫고 면접을 START_FAILED로 변경한다.
  전송하지 않으면 면접이 진행 중으로 남아 지원자는 오지 않을 질문을 기다린다.
- 면접 id는 배정 정보의 sessionId를 사용하고,
  배정 정보에서 읽지 못하면 방 이름(interview-{sessionId}, AI 명세 6.1)에서 읽는다.
  둘 다 읽지 못하면 어느 면접인지 알 수 없으므로 전송하지 않는다.
- 그룹 면접(배정 정보 kind GROUP 또는 방 이름 group-{groupId})은 groupId를 담아
  그룹 결과 큐(ai:results:group)로 전송한다(AI 명세 6.7).
  BE는 그룹이 질문을 하나도 내지 않았으면 그룹을 START_FAILED로 변경한다.
- 결과 큐 전송기는 동기 Redis 클라이언트이고 재시도 중 대기하므로 별도 스레드에서 실행한다.
"""

import asyncio
import json
import logging

from app.agent.assignment import GROUP_KIND
from app.common.results import (
    REASON,
    FailureReason,
    ResultPublisher,
    ResultPublishError,
    ResultType,
)
from app.common.session import GROUP_ROOM_NAME_PREFIX, ROOM_NAME_PREFIX

log = logging.getLogger(__name__)


def rejected_session_id(metadata: str | None, room_name: str) -> int | None:
    """거절한 배정의 면접 id다. 배정 정보와 방 이름에서 모두 읽지 못하면 None이다."""
    session_id = _metadata_id(metadata, "sessionId")
    return session_id if session_id is not None else _room_id(room_name, ROOM_NAME_PREFIX)


def is_group_room(metadata: str | None, room_name: str) -> bool:
    """그룹 면접 배정인지. 배정 정보의 kind나 방 이름(group-{groupId})으로 가린다."""
    data = _load(metadata)
    return (isinstance(data, dict) and data.get("kind") == GROUP_KIND) or room_name.startswith(
        GROUP_ROOM_NAME_PREFIX
    )


def rejected_group_id(metadata: str | None, room_name: str) -> int | None:
    """거절한 그룹 배정의 그룹 id다. 배정 정보와 방 이름에서 모두 읽지 못하면 None이다."""
    group_id = _metadata_id(metadata, "groupId")
    return group_id if group_id is not None else _room_id(room_name, GROUP_ROOM_NAME_PREFIX)


def _room_id(room_name: str, prefix: str) -> int | None:
    suffix = room_name.removeprefix(prefix)
    if suffix != room_name and suffix.isascii() and suffix.isdigit() and int(suffix) > 0:
        return int(suffix)
    return None


def _load(metadata: str | None) -> object:
    if not metadata:
        return None
    try:
        return json.loads(metadata)
    except (ValueError, RecursionError):
        # 지나치게 깊이 중첩된 JSON은 RecursionError가 발생한다
        return None


def _metadata_id(metadata: str | None, key: str) -> int | None:
    data = _load(metadata)
    value = data.get(key) if isinstance(data, dict) else None
    # JSON의 true·false는 파이썬에서 int이므로 bool을 제외한다
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return None


async def send_rejection(
    results: ResultPublisher, session_id: int | None, reason: FailureReason
) -> None:
    """assignment.rejected를 전송한다. 재시도 후에도 실패하면 오류 로그만 남긴다."""
    if session_id is None:
        log.error("면접 id를 알 수 없어 assignment.rejected를 전송하지 않는다 reason=%s", reason)
        return
    try:
        await asyncio.to_thread(
            results.publish, ResultType.ASSIGNMENT_REJECTED, session_id, {REASON: reason.value}
        )
    except ResultPublishError:
        log.error("assignment.rejected 전송 실패 sessionId=%s reason=%s", session_id, reason)


async def send_group_rejection(
    results: ResultPublisher, group_id: int | None, reason: FailureReason
) -> None:
    """그룹 면접의 assignment.rejected를 전송한다. results는 그룹 결과 큐 전송기다."""
    if group_id is None:
        log.error("그룹 id를 알 수 없어 assignment.rejected를 전송하지 않는다 reason=%s", reason)
        return
    try:
        await asyncio.to_thread(results.publish_group_rejection, group_id, {REASON: reason.value})
    except ResultPublishError:
        log.error("assignment.rejected 전송 실패 groupId=%s reason=%s", group_id, reason)
