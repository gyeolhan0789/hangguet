import pytest

from app.common.settings import LlmSettings, Settings, SettingsError, load_settings

LLM = {
    "LLM_CHAT_URL": "https://gms.example/v1/chat/completions",
    "LLM_MODEL": "gpt-test",
}


def test_starts_without_any_variable() -> None:
    """GMS 접속 값이 없어도 설정을 생성하고, 선택 값은 BE의 로컬 기본값을 사용한다."""
    settings = load_settings({})

    assert settings.redis_host == "localhost"
    assert settings.redis_port == 6379
    assert settings.llm_chat_url is None
    assert settings.llm_model is None
    assert settings.llm_api_key is None
    assert settings.jev_api_key is None
    assert settings.soniox_api_key is None
    assert settings.elevenlabs_api_key is None
    assert settings.s3_bucket is None
    assert settings.aws_region is None
    assert settings.livekit_url is None
    assert settings.livekit_api_key is None
    assert settings.livekit_api_secret is None
    assert settings.worker_queue is None


def test_llm_reports_every_missing_name_without_values() -> None:
    """GMS 접속 값이 없으면 누락된 이름을 모두 포함하고 설정된 값은 포함하지 않는다."""
    settings = load_settings({"LLM_API_KEY": "llm-key-value"})

    with pytest.raises(SettingsError) as raised:
        settings.llm()

    message = str(raised.value)
    assert "LLM_CHAT_URL" in message
    assert "LLM_MODEL" in message
    assert "llm-key-value" not in message


def test_llm_reports_only_missing_name() -> None:
    settings = load_settings({"LLM_MODEL": "gpt-test"})

    with pytest.raises(SettingsError) as raised:
        settings.llm()

    assert "LLM_CHAT_URL" in str(raised.value)
    assert "LLM_MODEL" not in str(raised.value)
    assert "gpt-test" not in str(raised.value)


def test_empty_value_is_missing() -> None:
    """compose에서 값 없이 선언된 변수는 누락으로 처리한다."""
    settings = load_settings({**LLM, "LLM_MODEL": ""})

    with pytest.raises(SettingsError, match="LLM_MODEL"):
        settings.llm()


def test_llm_returns_connection_values() -> None:
    settings = load_settings({**LLM, "LLM_API_KEY": "llm-key"})

    assert settings.llm() == LlmSettings(
        chat_url=LLM["LLM_CHAT_URL"], model="gpt-test", api_key="llm-key"
    )


def test_llm_api_key_is_optional() -> None:
    """company-pipeline/pipeline/card.py와 같이 키가 없으면 인증 헤더 없이 호출할 수 있게 한다."""
    assert load_settings(LLM).llm().api_key is None


def test_reads_every_variable() -> None:
    env = {
        **LLM,
        "LLM_API_KEY": "llm-key",
        "REDIS_HOST": "redis",
        "REDIS_PORT": "6380",
        "JEV_API_KEY": "jev-key",
        "SONIOX_API_KEY": "soniox-key",
        "ELEVENLABS_API_KEY": "elevenlabs-key",
        "S3_BUCKET": "recordings-bucket",
        "AWS_REGION": "ap-northeast-2",
        "LIVEKIT_URL": "ws://livekit:7880",
        "LIVEKIT_API_KEY": "livekit-key",
        "LIVEKIT_API_SECRET": "livekit-secret",
        "AI_WORKER_QUEUE": "plan",
    }

    settings = load_settings(env)

    assert settings == Settings(
        llm_chat_url=LLM["LLM_CHAT_URL"],
        llm_model="gpt-test",
        llm_api_key="llm-key",
        redis_host="redis",
        redis_port=6380,
        jev_api_key="jev-key",
        soniox_api_key="soniox-key",
        elevenlabs_api_key="elevenlabs-key",
        s3_bucket="recordings-bucket",
        aws_region="ap-northeast-2",
        livekit_url="ws://livekit:7880",
        livekit_api_key="livekit-key",
        livekit_api_secret="livekit-secret",
        worker_queue="plan",
    )


def test_ignores_database_variables() -> None:
    """AI는 DB에 접속하지 않으므로(AI 명세 1장) DB 접속 변수를 설정에 포함하지 않는다."""
    settings = load_settings({"DB_HOST": "postgres", "DB_PASSWORD": "db-password-value"})

    assert not any(name.startswith("db_") for name in vars(settings))
    assert "db-password-value" not in repr(settings)


@pytest.mark.parametrize("value", ["abc", "0", "65536", "-1", "６３７９"])
def test_rejects_invalid_port_at_load_with_name_only(value: str) -> None:
    with pytest.raises(SettingsError) as raised:
        load_settings({"REDIS_PORT": value})

    assert "REDIS_PORT" in str(raised.value)
    assert value not in str(raised.value)


@pytest.mark.parametrize("value", ["1", "65535"])
def test_accepts_port_range_boundaries(value: str) -> None:
    assert load_settings({"REDIS_PORT": value}).redis_port == int(value)


def test_repr_hides_secret_values() -> None:
    """비밀 값은 객체 문자열 표현에 포함하지 않는다."""
    secrets = {
        "LLM_API_KEY": "llm-key-value",
        "JEV_API_KEY": "jev-key-value",
        "SONIOX_API_KEY": "soniox-key-value",
        "ELEVENLABS_API_KEY": "elevenlabs-key-value",
        "LIVEKIT_API_KEY": "livekit-key-value",
        "LIVEKIT_API_SECRET": "livekit-secret-value",
    }
    settings = load_settings({**LLM, **secrets})

    text = repr(settings) + repr(settings.llm())

    for secret in secrets.values():
        assert secret not in text
    assert "gpt-test" in text
