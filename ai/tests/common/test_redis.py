from app.common.redis import SOCKET_TIMEOUT_SECONDS, create_redis
from app.common.settings import load_settings


def test_redis_client_uses_settings() -> None:
    client = create_redis(load_settings({"REDIS_HOST": "redis", "REDIS_PORT": "6380"}))

    kwargs = client.connection_pool.connection_kwargs
    assert (kwargs["host"], kwargs["port"]) == ("redis", 6380)
    assert kwargs["decode_responses"] is True
    assert kwargs["socket_timeout"] == SOCKET_TIMEOUT_SECONDS
