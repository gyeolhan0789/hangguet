"""면접방이 닫히면 BE에 room.closed를 전송한다(AI 명세 1.4·6.5).

- LiveKit은 사람 참가자(지원자)가 모두 나가고 departure_timeout(BE 지정 10분)이 지나면
  방을 닫고, 남은 에이전트의 연결을 ROOM_CLOSED로 끊는다(LiveKit 서버 v1.13.10 Room.CloseIfEmpty).
  BE는 이 메시지를 받아야 끝내기(API 명세 5.8) 없이 떠난 면접을 끝낸다.
  보내지 않으면 면접이 IN_PROGRESS로 남아 화상 동시 진행 자리를 차지한다.
- BE가 방을 지운 경우(ROOM_DELETED: 끝내기·시작 실패)는 BE가 이미 처리했으므로 보내지 않는다.
- 연결만 끊긴 경우(SIGNAL_CLOSE·CONNECTION_TIMEOUT 등)는 방이 남아 있고
  LiveKit이 새 에이전트를 배정하므로 보내지 않는다.
- 결과 큐 전송기는 동기 Redis 클라이언트이고 재시도 중 대기하므로 별도 스레드에서 실행한다.
"""

import asyncio
import logging

from livekit import rtc

from app.common.results import ResultPublisher, ResultPublishError, ResultType

log = logging.getLogger(__name__)


def closed_by_livekit(reason: object) -> bool:
    """사람 참가자가 모두 떠나 LiveKit이 방을 닫아 연결이 끊겼는지다."""
    return reason == rtc.DisconnectReason.ROOM_CLOSED


async def send_room_closed(results: ResultPublisher, session_id: int) -> None:
    """room.closed를 전송한다. 재시도 후에도 실패하면 오류 로그만 남긴다."""
    try:
        await asyncio.to_thread(results.publish, ResultType.ROOM_CLOSED, session_id, {})
    except ResultPublishError:
        log.error("room.closed 전송 실패 sessionId=%s", session_id)
