"""Redis 클라이언트를 설정 값으로 생성한다."""

from redis import Redis

from app.common.settings import Settings

# 응답 대기 상한(초). redis-py 기본값(5초)은 작업 큐의 BLMOVE 대기와 같아
# 빈 큐에서 Redis의 nil 응답보다 읽기 시간 초과가 먼저 발생하고, 재시도가 반복돼
# 수신이 약 1분 정지한다. 그래서 작업 큐의 BLMOVE 대기(5초 안팎)보다 충분히 길게 둔다.
SOCKET_TIMEOUT_SECONDS = 15.0


def create_redis(settings: Settings) -> Redis:
    # 작업 메시지와 결과 메시지는 JSON 문자열로 다루므로 응답을 bytes 대신 str로 수신한다
    return Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        decode_responses=True,
        socket_timeout=SOCKET_TIMEOUT_SECONDS,
    )
