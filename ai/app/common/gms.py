"""GMS(OpenAI 호환 chat completions)를 JSON 응답 형식으로 호출한다.

AI 명세 5장의 「3회 재시도」는 첫 호출 뒤 재시도 3번, 즉 최대 4번 호출로 해석한다.
재시도 대상은 타임아웃·429·5xx이고, 그 밖의 4xx는 요청 자체가 잘못된 것이라 재시도해도
결과가 같으므로 즉시 실패로 처리한다.
출력 구조 깨짐의 재시도는 응답을 검증하는 호출 측이 담당한다.
전송 함수를 주입받으므로 테스트는 유료 호출 없이 동작한다.
작업마다 BE 최대 대기 시간이 있으므로(AI 명세 5장) 호출 전마다 마감을 확인하는 with_deadline을
질문 생성과 결과 생성이 함께 사용한다.
"""

import http.client
import json
import logging
import math
import re
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.common.settings import Settings
from app.common.timing import elapsed_ms
from app.common.versions import REGISTRY, VersionKind

log = logging.getLogger(__name__)

# 재시도 간격(초)과 요청 타임아웃(초).
# 운영 응답 시간을 측정하기 전이라 GMS 일시 장애가
# 해소될 때까지 대기할 수 있는 값으로 두었고, 측정 뒤 조정한다
BACKOFF_SECONDS = (1.0, 2.0, 4.0)
REQUEST_TIMEOUT_SECONDS = 60.0
# 재시도마다 간격이 하나씩 필요하므로 횟수를 간격 목록에서 계산해 두 값이 어긋나지 않게 한다
MAX_RETRIES = len(BACKOFF_SECONDS)
# Retry-After 상한(초).
# 서버가 긴 대기를 지정해도 작업자가 장시간 정지하지 않도록 한다
MAX_RETRY_AFTER_SECONDS = 60.0
# AI 명세 5장: 응답 구조가 깨지면(JSON 아님, 개수·판정 값 틀림) 1회 재시도한다.
# 질문 생성·채점·결과 생성이 같은 횟수를 사용하도록 GMS 호출 모듈 한 곳에 둔다
STRUCTURE_RETRIES = 1

# 추론 모델이 JSON 앞에 추가하는 사고 과정 블록.
# company-pipeline/pipeline/card.py의 parse_reply와 같은 처리다
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.S)


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


# 요청 본문을 전송하고 응답을 반환한다.
# 시간 초과면 TimeoutError를 발생시킨다.
Transport = Callable[[dict[str, Any]], HttpResponse]


@dataclass(frozen=True)
class GmsResult:
    content: dict[str, Any]
    model: str


# 메시지를 전송하고 GMS 응답을 반환한다.
# GmsClient.chat_json의 인자를 고정한 함수이고,
# 테스트는 유료 호출 대신 대역을 주입한다
Chat = Callable[[Sequence[Mapping[str, str]]], GmsResult]


class GmsUnavailableError(Exception):
    """재시도를 모두 실패했거나 재시도 대상이 아닌 오류 응답을 수신했다."""


class GmsBadOutputError(Exception):
    """응답 본문이 JSON 객체가 아니다(AI 명세 5장 출력 구조 깨짐)."""


class GmsDeadlineError(Exception):
    """작업 마감이 지나 GMS를 호출하지 않았다(AI 명세 5장 BE 최대 대기 시간 초과)."""


def with_structure_retry[T](
    attempt: Callable[[], T], *, retry_on: tuple[type[Exception], ...], label: str
) -> T:
    """지정한 출력 구조 오류만 재시도하고 최종 오류는 재전파한다."""
    for _ in range(STRUCTURE_RETRIES):
        try:
            return attempt()
        except retry_on as error:
            log.warning("출력 구조 오류 재시도 %s error=%s", label, type(error).__name__)
    return attempt()


def with_deadline(chat: Chat, deadline: float, clock: Callable[[], float] = time.time) -> Chat:
    """GMS를 호출하기 전마다 마감을 확인한다.

    출력 구조 재시도의 호출도 포함한다.

    마감은 BE가 작업을 요청한 시각에서 계산한 Unix 시각(초)이므로 clock도 같은 기준(time.time)이다.

    마감이 지나면 BE가 그 작업을 FAILED로 처리하므로, 그 작업에 GMS 비용과 처리 시간을 사용하지 않고
    대기 중인 다른 작업을 처리하게 한다.
    """

    def call(messages: Sequence[Mapping[str, str]]) -> GmsResult:
        if clock() > deadline:
            raise GmsDeadlineError("작업 마감이 지났다")
        return chat(messages)

    return call


def _retryable(status: int) -> bool:
    return status == 429 or status >= 500


def _retry_after(headers: Mapping[str, str]) -> float | None:
    value = next((v for k, v in headers.items() if k.lower() == "retry-after"), None)
    if value is None:
        return None
    try:
        seconds = float(value)
    except ValueError:
        # HTTP 날짜 형식은 지원하지 않고 기본 간격을 사용한다
        return None
    # inf·nan은 sleep에서 오류가 발생하므로 기본 간격을 사용한다
    if not math.isfinite(seconds):
        return None
    return min(max(0.0, seconds), MAX_RETRY_AFTER_SECONDS)


def _log_usage(data: Mapping[str, Any]) -> None:
    """GMS 비용을 작업 종류·면접별로 다시 집계할 수 있도록 호출마다 토큰 수를 로그로 남긴다.

    분석 작업자에는 지표 서버가 없고, 호출 단위로 남겨야 나중에 원하는 기준으로 묶을 수 있다.
    응답에 사용량이 없으면 판정에는 영향이 없으므로 남기지 않는다.
    """
    usage = data.get("usage")
    if not isinstance(usage, Mapping):
        return
    prompt, completion = usage.get("prompt_tokens"), usage.get("completion_tokens")
    if not isinstance(prompt, int) or not isinstance(completion, int):
        return
    log.info("GMS 사용량 promptTokens=%d completionTokens=%d", prompt, completion)


class GmsClient:
    def __init__(
        self,
        *,
        model: str,
        transport: Transport,
        sleep: Callable[[float], None] = time.sleep,
        timer: Callable[[], float] = time.monotonic,
    ) -> None:
        self._model = model
        self._transport = transport
        self._sleep = sleep
        self._timer = timer

    @classmethod
    def from_settings(cls, settings: Settings) -> "GmsClient":
        """GMS를 처음 사용하는 시점에 접속 값과 모델을 검사한다.

        접속 값이 없으면 SettingsError를, LLM_MODEL이 등록된 Model 버전이 아니면
        UnregisteredVersionError를 발생시킨다(AI 명세 9장).
        """
        llm = settings.llm()
        REGISTRY.require(VersionKind.MODEL, llm.model)
        return cls(model=llm.model, transport=urllib_transport(llm.chat_url, llm.api_key))

    def chat_json(self, messages: Sequence[Mapping[str, str]]) -> GmsResult:
        # gpt-5.6-terra는 temperature 0과 logprobs 요청을 400으로 거절하므로
        # 두 값을 전송하지 않는다
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": list(messages),
            "response_format": {"type": "json_object"},
        }
        response = self._send_with_retry(payload)
        try:
            data = json.loads(response.body)
            content = json.loads(_THINK_BLOCK.sub("", data["choices"][0]["message"]["content"]))
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise GmsBadOutputError("GMS 응답을 JSON으로 해석하지 못했다") from e
        if not isinstance(content, dict):
            raise GmsBadOutputError("GMS 응답이 JSON 객체가 아니다")
        _log_usage(data)
        return GmsResult(content=content, model=str(data.get("model") or self._model))

    def _send_with_retry(self, payload: dict[str, Any]) -> HttpResponse:
        # 재시도 대기를 포함한 전체 시간이 BE 대기 상한에 영향을 주므로 호출 전체를 잰다
        started = self._timer()
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = self._transport(payload)
            except TimeoutError:
                reason, wait = "timeout", None
            else:
                if 200 <= response.status < 300:
                    ms = elapsed_ms(started, self._timer())
                    log.info("GMS 호출 완료 ms=%d attempts=%d", ms, attempt + 1)
                    return response
                if not _retryable(response.status):
                    self._log_failure(started, attempt + 1)
                    raise GmsUnavailableError(f"GMS 오류 응답 {response.status}")
                reason, wait = str(response.status), _retry_after(response.headers)
            if attempt == MAX_RETRIES:
                break
            # 서버가 대기 시간을 지정하면 그 값이 처리량 제한 해제 시점이므로 우선한다
            delay = wait if wait is not None else BACKOFF_SECONDS[attempt]
            log.warning("GMS 재시도 %d/%d (%s)", attempt + 1, MAX_RETRIES, reason)
            self._sleep(delay)
        self._log_failure(started, MAX_RETRIES + 1)
        raise GmsUnavailableError(f"GMS 호출 {MAX_RETRIES + 1}회 실패")

    def _log_failure(self, started: float, attempts: int) -> None:
        ms = elapsed_ms(started, self._timer())
        log.warning("GMS 호출 실패 ms=%d attempts=%d", ms, attempts)


def urllib_transport(url: str, api_key: str | None) -> Transport:
    """urllib로 전송한다.

    company-pipeline/pipeline/card.py와 같은 방식이라 HTTP 의존성을 추가하지 않는다.
    """

    def send(payload: dict[str, Any]) -> HttpResponse:
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as res:
                return HttpResponse(res.status, dict(res.headers.items()), res.read())
        except urllib.error.HTTPError as e:
            return HttpResponse(e.code, dict(e.headers.items()), e.read())
        except urllib.error.URLError as e:
            # 연결 단계의 시간 초과는 URLError로 감싸져 발생하므로 재시도 대상으로 변환한다
            if isinstance(e.reason, TimeoutError):
                raise TimeoutError(str(e.reason)) from e
            raise GmsUnavailableError("GMS에 연결하지 못했다") from e
        except TimeoutError:
            # 응답 수신 중 시간 초과도 재시도 대상이므로 그대로 전파한다
            raise
        except (OSError, http.client.HTTPException) as e:
            # 응답 수신 중 연결이 중단된 경우다.
            # 재시도 대상(타임아웃·429·5xx)이 아니므로,
            # 연결 실패와 같이 처리해 호출 측이 GmsUnavailableError 하나만 처리하게 한다
            raise GmsUnavailableError("GMS 응답을 수신하지 못했다") from e

    return send
