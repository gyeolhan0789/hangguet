"""분석 작업자와 면접 에이전트가 함께 읽는 환경 변수.

변수 이름은 같은 값을 사용하는 쪽과 일치시킨다.
- REDIS_HOST·REDIS_PORT: BE application.yml(같은 Redis의 작업 큐·결과 큐를 공유한다)
- SONIOX_API_KEY·ELEVENLABS_API_KEY: BE application.yml에서 사용하던 이름이다. 키는 AI 서버에만 둔다
  (AI 명세 1장).
- LLM_*: company-pipeline/pipeline/card.py
- JEV_API_KEY: Jev SDK 예제의 TYPESAFE_API_KEY와 같은 값이다.
- S3_BUCKET·AWS_REGION: BE와 같은 이름이다(deploy/dev/compose.yml).
  녹화 합치기가 같은 버킷에서 원본 트랙을 다운로드하고 합친 녹화를 업로드한다.
  자격 증명은 BE와 같이 AWS 기본 공급자(AWS_ACCESS_KEY_ID 등)에서 읽으므로 이 모듈에 두지 않는다.
- AI_WORKER_QUEUE: 분석 작업자가 수신할 큐(AI 명세 1.3). 값 검사는 app.worker.queue가 한다.
AI는 DB에 접속하지 않으므로(AI 명세 1장) DB 접속 변수는 두지 않는다.
기본값은 BE application.yml의 기본값(로컬 docker-compose 기준)과 같다.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field

WORKER_QUEUE_ENV = "AI_WORKER_QUEUE"
DEFAULT_REDIS_HOST = "localhost"
DEFAULT_REDIS_PORT = 6379


class SettingsError(ValueError):
    """환경 변수가 없거나 형식이 올바르지 않다. 메시지에는 값을 포함하지 않는다."""


@dataclass(frozen=True, kw_only=True)
class LlmSettings:
    chat_url: str
    model: str
    api_key: str | None = field(repr=False)


@dataclass(frozen=True, kw_only=True)
class Settings:
    llm_chat_url: str | None
    llm_model: str | None
    # 비밀 값은 로그나 오류 메시지에 객체가 출력돼도 노출되지 않도록 repr에서 제외한다
    llm_api_key: str | None = field(repr=False)
    redis_host: str
    redis_port: int
    jev_api_key: str | None = field(repr=False)
    soniox_api_key: str | None = field(repr=False)
    elevenlabs_api_key: str | None = field(repr=False)
    s3_bucket: str | None = None
    aws_region: str | None = None
    worker_queue: str | None = None

    def llm(self) -> LlmSettings:
        """GMS 접속 값을 반환한다. LLM_CHAT_URL·LLM_MODEL이 없으면 누락된 이름을 포함해 실패한다.

        LLM_API_KEY는 company-pipeline/pipeline/card.py와 같이 선택 값으로 두고,
        없으면 인증 헤더 없이 호출한다.

        시작 시점이 아니라 GMS를 처음 사용할 때 검사한다. 배포 환경에 LLM_* 값이 추가되기 전에
        병합돼도 GMS를 사용하지 않는 기능은 동작하도록 하기 위함이다.
        """
        missing = [
            name
            for name, value in (("LLM_CHAT_URL", self.llm_chat_url), ("LLM_MODEL", self.llm_model))
            if value is None
        ]
        if self.llm_chat_url is None or self.llm_model is None:
            raise SettingsError(f"GMS 환경 변수가 없다: {', '.join(missing)}")
        return LlmSettings(
            chat_url=self.llm_chat_url, model=self.llm_model, api_key=self.llm_api_key
        )


def _optional(env: Mapping[str, str], name: str) -> str | None:
    # 빈 문자열은 compose에서 값 없이 선언된 변수이므로 설정하지 않은 것으로 본다
    value = env.get(name, "")
    return value or None


def _port(env: Mapping[str, str], name: str, default: int) -> int:
    value = _optional(env, name)
    if value is None:
        return default
    if not (value.isascii() and value.isdigit()) or not 0 < int(value) < 65536:
        raise SettingsError(f"환경 변수 {name}는 1~65535 사이의 정수여야 한다")
    return int(value)


def load_settings(env: Mapping[str, str]) -> Settings:
    """환경 변수로 설정을 생성한다. 형식이 틀린 값은 이 시점에 변수 이름을 포함해 실패한다."""
    return Settings(
        llm_chat_url=_optional(env, "LLM_CHAT_URL"),
        llm_model=_optional(env, "LLM_MODEL"),
        llm_api_key=_optional(env, "LLM_API_KEY"),
        redis_host=_optional(env, "REDIS_HOST") or DEFAULT_REDIS_HOST,
        redis_port=_port(env, "REDIS_PORT", DEFAULT_REDIS_PORT),
        jev_api_key=_optional(env, "JEV_API_KEY"),
        soniox_api_key=_optional(env, "SONIOX_API_KEY"),
        elevenlabs_api_key=_optional(env, "ELEVENLABS_API_KEY"),
        s3_bucket=_optional(env, "S3_BUCKET"),
        aws_region=_optional(env, "AWS_REGION"),
        worker_queue=_optional(env, WORKER_QUEUE_ENV),
    )
