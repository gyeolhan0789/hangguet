"""Redis 클라이언트를 설정 값으로 생성한다."""

from redis import Redis
from redis.backoff import NoBackoff
from redis.retry import Retry

from app.common.settings import Settings

# 응답 대기 상한(초). redis-py 기본값(5초)은 작업 큐의 BLMOVE 대기와 같아
# 빈 큐에서 Redis의 nil 응답보다 읽기 시간 초과가 먼저 발생하고, 재시도가 반복돼
# 수신이 약 1분 정지한다. 그래서 작업 큐의 BLMOVE 대기(5초 안팎)보다 충분히 길게 둔다.
SOCKET_TIMEOUT_SECONDS = 15.0

# 면접 에이전트가 결과 메시지를 전송할 때 연결·응답을 기다리는 상한(초).
# 결과 전송은 명세의 재시도(1·2·4초 간격 3회, AI 명세 5장)만 사용하므로,
# redis-py 자체 재시도(기본 10회)를 사용하지 않는다.
# 두 재시도가 겹치면 Redis가 끊겼을 때 실패를 판단하기까지 약 3분이 걸려,
# 지원자가 그동안 답변 제출 결과를 기다리게 된다(AI 명세 6.5).
PUBLISH_TIMEOUT_SECONDS = 2.0


def create_redis(settings: Settings) -> Redis:
    # 작업 메시지와 결과 메시지는 JSON 문자열로 다루므로 응답을 bytes 대신 str로 수신한다
    return Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        decode_responses=True,
        socket_timeout=SOCKET_TIMEOUT_SECONDS,
    )


def create_publisher_redis(settings: Settings) -> Redis:
    """면접 에이전트가 결과 메시지를 전송할 Redis 클라이언트를 생성한다.

    전송 한 번은 PUBLISH_TIMEOUT_SECONDS 안에 성공하거나 실패하고,
    실패하면 ResultPublisher가 명세의 간격으로 다시 전송한다.
    """
    return Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        decode_responses=True,
        socket_timeout=PUBLISH_TIMEOUT_SECONDS,
        socket_connect_timeout=PUBLISH_TIMEOUT_SECONDS,
        retry=Retry(NoBackoff(), 0),
    )
