"""배정을 거절하면 BE에 assignment.rejected를 전송한다(AI 명세 1.4·6.5).

- BE는 이 메시지를 수신해야 면접방을 닫고 면접을 START_FAILED로 변경한다.
  전송하지 않으면 면접이 진행 중으로 남아 지원자는 오지 않을 질문을 기다린다.
- 면접 id는 배정 정보의 sessionId를 사용하고,
  배정 정보에서 읽지 못하면 방 이름(interview-{sessionId}, AI 명세 6.1)에서 읽는다.
  둘 다 읽지 못하면 어느 면접인지 알 수 없으므로 전송하지 않는다.
- 결과 큐 전송기는 동기 Redis 클라이언트이고 재시도 중 대기하므로 별도 스레드에서 실행한다.
"""

import asyncio
import json
import logging

from app.common.results import (
    REASON,
    FailureReason,
    ResultPublisher,
    ResultPublishError,
    ResultType,
)
from app.common.session import ROOM_NAME_PREFIX

log = logging.getLogger(__name__)


def rejected_session_id(metadata: str | None, room_name: str) -> int | None:
    """거절한 배정의 면접 id다. 배정 정보와 방 이름에서 모두 읽지 못하면 None이다."""
    session_id = _metadata_session_id(metadata)
    if session_id is not None:
        return session_id
    suffix = room_name.removeprefix(ROOM_NAME_PREFIX)
    if suffix != room_name and suffix.isascii() and suffix.isdigit() and int(suffix) > 0:
        return int(suffix)
    return None


def _metadata_session_id(metadata: str | None) -> int | None:
    if not metadata:
        return None
    try:
        data = json.loads(metadata)
    except (ValueError, RecursionError):
        # 지나치게 깊이 중첩된 JSON은 RecursionError가 발생한다
        return None
    value = data.get("sessionId") if isinstance(data, dict) else None
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
