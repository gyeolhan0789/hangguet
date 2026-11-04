import pytest
from redis.connection import Connection
from redis.exceptions import ConnectionError as RedisConnectionError

from app.common.redis import (
    PUBLISH_TIMEOUT_SECONDS,
    SOCKET_TIMEOUT_SECONDS,
    create_publisher_redis,
    create_redis,
)
from app.common.settings import load_settings


def test_redis_client_uses_settings() -> None:
    client = create_redis(load_settings({"REDIS_HOST": "redis", "REDIS_PORT": "6380"}))

    kwargs = client.connection_pool.connection_kwargs
    assert (kwargs["host"], kwargs["port"]) == ("redis", 6380)
    assert kwargs["decode_responses"] is True
    assert kwargs["socket_timeout"] == SOCKET_TIMEOUT_SECONDS


def test_publisher_client_uses_settings_and_short_timeouts() -> None:
    client = create_publisher_redis(load_settings({"REDIS_HOST": "redis", "REDIS_PORT": "6380"}))

    kwargs = client.connection_pool.connection_kwargs
    assert (kwargs["host"], kwargs["port"]) == ("redis", 6380)
    assert kwargs["decode_responses"] is True
    assert kwargs["socket_timeout"] == PUBLISH_TIMEOUT_SECONDS
    assert kwargs["socket_connect_timeout"] == PUBLISH_TIMEOUT_SECONDS


def test_publisher_client_tries_to_connect_only_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """결과 전송의 재시도는 ResultPublisher가 명세 간격으로 하므로,
    클라이언트는 다시 연결하지 않는다.

    redis-py 자체 재시도가 겹치면,
    Redis가 끊겼을 때 실패를 판단하기까지 약 3분이 걸린다(AI 명세 6.5).
    """
    attempts = 0

    def refuse(self: Connection) -> None:
        nonlocal attempts
        attempts += 1
        raise OSError(111, "Connection refused")

    monkeypatch.setattr(Connection, "_connect", refuse)
    client = create_publisher_redis(load_settings({"REDIS_HOST": "redis", "REDIS_PORT": "6379"}))

    with pytest.raises(RedisConnectionError):
        client.lpush("ai:results", "{}")

    assert attempts == 1
