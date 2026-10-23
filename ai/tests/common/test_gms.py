import http.client
import json
import urllib.error
import urllib.request
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

import pytest

from app.common.gms import (
    BACKOFF_SECONDS,
    MAX_RETRY_AFTER_SECONDS,
    GmsBadOutputError,
    GmsClient,
    GmsDeadlineError,
    GmsResult,
    GmsUnavailableError,
    HttpResponse,
    urllib_transport,
    with_deadline,
)
from app.common.settings import SettingsError, load_settings
from app.common.versions import UnregisteredVersionError

MESSAGES = [{"role": "user", "content": "판정하라"}]


def ok(content: str = '{"level": 3}', *, logprobs: Any = None) -> HttpResponse:
    choice: dict[str, Any] = {"message": {"content": content}}
    if logprobs is not None:
        choice["logprobs"] = logprobs
    body = {"model": "gpt-served", "choices": [choice]}
    return HttpResponse(200, {}, json.dumps(body).encode())


def status(code: int, headers: dict[str, str] | None = None) -> HttpResponse:
    return HttpResponse(code, headers or {}, b"{}")


class FakeTransport:
    """정해진 순서로 응답하거나 시간 초과를 발생시키고 전송한 요청을 기록한다."""

    def __init__(self, outcomes: Iterable[HttpResponse | Exception]) -> None:
        self._outcomes = list(outcomes)
        self.payloads: list[dict[str, Any]] = []

    def __call__(self, payload: dict[str, Any]) -> HttpResponse:
        self.payloads.append(payload)
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def client(transport: FakeTransport, sleeps: list[float]) -> GmsClient:
    return GmsClient(model="gpt-test", transport=transport, sleep=sleeps.append)


def test_sends_json_mode_with_zero_temperature() -> None:
    transport = FakeTransport([ok()])

    result = client(transport, []).chat_json(MESSAGES)

    assert transport.payloads == [
        {
            "model": "gpt-test",
            "messages": MESSAGES,
            "response_format": {"type": "json_object"},
            "temperature": 0,
        }
    ]
    assert result.content == {"level": 3}
    assert result.model == "gpt-served"


def test_retries_after_429_then_succeeds() -> None:
    transport = FakeTransport([status(429), ok()])
    sleeps: list[float] = []

    result = client(transport, sleeps).chat_json(MESSAGES)

    assert result.content == {"level": 3}
    assert len(transport.payloads) == 2
    assert sleeps == [BACKOFF_SECONDS[0]]


def test_retry_after_header_takes_precedence() -> None:
    transport = FakeTransport([status(429, {"Retry-After": "7"}), ok()])
    sleeps: list[float] = []

    client(transport, sleeps).chat_json(MESSAGES)

    assert sleeps == [7.0]


def test_raises_unavailable_after_four_5xx_calls() -> None:
    """첫 호출과 재시도 3번을 모두 실패하면 최대 4번 호출하고 실패한다."""
    transport = FakeTransport([status(500), status(502), status(503), status(504)])
    sleeps: list[float] = []

    with pytest.raises(GmsUnavailableError):
        client(transport, sleeps).chat_json(MESSAGES)

    assert len(transport.payloads) == 4
    assert sleeps == list(BACKOFF_SECONDS)


def test_other_4xx_fails_without_retry() -> None:
    transport = FakeTransport([status(400), ok()])
    sleeps: list[float] = []

    with pytest.raises(GmsUnavailableError):
        client(transport, sleeps).chat_json(MESSAGES)

    assert len(transport.payloads) == 1
    assert sleeps == []


def test_redirect_status_fails_without_retry() -> None:
    """3xx는 성공 응답이 아니며 재시도해도 결과가 같으므로 즉시 실패로 처리한다."""
    transport = FakeTransport([status(300), ok()])
    sleeps: list[float] = []

    with pytest.raises(GmsUnavailableError):
        client(transport, sleeps).chat_json(MESSAGES)

    assert len(transport.payloads) == 1
    assert sleeps == []


def test_retries_after_timeout_then_succeeds() -> None:
    transport = FakeTransport([TimeoutError(), ok()])
    sleeps: list[float] = []

    result = client(transport, sleeps).chat_json(MESSAGES)

    assert result.content == {"level": 3}
    assert len(transport.payloads) == 2
    assert sleeps == [BACKOFF_SECONDS[0]]


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("3600", MAX_RETRY_AFTER_SECONDS),
        ("inf", BACKOFF_SECONDS[0]),
        ("nan", BACKOFF_SECONDS[0]),
        ("-5", 0.0),
    ],
)
def test_retry_after_is_capped_and_finite(header: str, expected: float) -> None:
    """서버가 지정한 대기 시간이 길거나 유한하지 않아도 작업자가 장시간 정지하지 않는다.

    음수는 time.sleep에서 ValueError가 발생하므로 0으로 제한한다.
    """
    transport = FakeTransport([status(429, {"Retry-After": header}), ok()])
    sleeps: list[float] = []

    client(transport, sleeps).chat_json(MESSAGES)

    assert sleeps == [expected]


@pytest.mark.parametrize("content", ["판정 불가", "[1, 2]", ""])
def test_non_object_content_is_bad_output(content: str) -> None:
    transport = FakeTransport([ok(content)])

    with pytest.raises(GmsBadOutputError):
        client(transport, []).chat_json(MESSAGES)

    assert len(transport.payloads) == 1


def test_strips_think_block_before_parsing() -> None:
    transport = FakeTransport([ok('<think>근거 검토</think>{"level": 2}')])

    assert client(transport, []).chat_json(MESSAGES).content == {"level": 2}


def test_missing_logprobs_returns_none() -> None:
    """확률을 요청해도 응답에 없으면 None을 반환해 호출 측이 고정 점수 방식을 선택하게 한다."""
    transport = FakeTransport([ok()])

    result = client(transport, []).chat_json(MESSAGES, logprobs=True, top_logprobs=3)

    assert transport.payloads[0]["logprobs"] is True
    assert transport.payloads[0]["top_logprobs"] == 3
    assert result.token_logprobs is None


def test_parses_token_logprobs() -> None:
    logprobs = {
        "content": [
            {
                "token": "3",
                "logprob": -0.1,
                "top_logprobs": [{"token": "3", "logprob": -0.1}, {"token": "2", "logprob": -2.4}],
            }
        ]
    }
    transport = FakeTransport([ok(logprobs=logprobs)])

    result = client(transport, []).chat_json(MESSAGES, logprobs=True)

    assert result.token_logprobs is not None
    [token] = result.token_logprobs
    assert (token.token, token.logprob) == ("3", -0.1)
    assert token.top == {"3": -0.1, "2": -2.4}


class FakeUrlResponse:
    """응답 본문을 수신하는 중에 지정한 예외를 발생시키는 urlopen 응답 대역."""

    status = 200
    headers: dict[str, str] = {}

    def __init__(self, error: Exception) -> None:
        self._error = error

    def __enter__(self) -> "FakeUrlResponse":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def read(self) -> bytes:
        raise self._error


@pytest.mark.parametrize(
    "error",
    [
        http.client.RemoteDisconnected("closed"),
        ConnectionResetError("reset"),
        http.client.IncompleteRead(b""),
    ],
)
def test_transport_wraps_dropped_connection_as_unavailable(
    monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    """호출 측이 GmsUnavailableError만 처리해도 응답 수신 중 연결 중단을 누락하지 않는다."""
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: FakeUrlResponse(error))

    with pytest.raises(GmsUnavailableError):
        urllib_transport("http://gms.test", None)({})


def test_transport_propagates_read_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda *a, **k: FakeUrlResponse(TimeoutError("timed out"))
    )

    with pytest.raises(TimeoutError):
        urllib_transport("http://gms.test", None)({})


def test_transport_unwraps_connect_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """연결 단계 시간 초과는 URLError로 감싸져 발생하므로 재시도 대상인 TimeoutError로 변환한다."""

    def fail(*args: object, **kwargs: object) -> None:
        raise urllib.error.URLError(TimeoutError("timed out"))

    monkeypatch.setattr("urllib.request.urlopen", fail)

    with pytest.raises(TimeoutError):
        urllib_transport("http://gms.test", None)({})


def test_from_settings_requires_llm_values() -> None:
    """GMS 접속 값이 없으면 클라이언트를 생성하는 시점에 변수 이름을 포함해 실패한다."""
    with pytest.raises(SettingsError, match="LLM_CHAT_URL"):
        GmsClient.from_settings(load_settings({"LLM_MODEL": "gpt-test"}))


def test_from_settings_rejects_unregistered_model() -> None:
    """등록되지 않은 모델로는 GMS를 호출하지 않는다."""
    settings = load_settings({"LLM_CHAT_URL": "http://gms.test/chat", "LLM_MODEL": "gpt-x"})

    with pytest.raises(UnregisteredVersionError, match="gpt-x"):
        GmsClient.from_settings(settings)


def test_from_settings_sends_bearer_key_to_chat_url(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[urllib.request.Request] = []

    def capture(req: urllib.request.Request, **kwargs: object) -> FakeOkResponse:
        requests.append(req)
        return FakeOkResponse()

    monkeypatch.setattr("urllib.request.urlopen", capture)
    settings = load_settings(
        {"LLM_CHAT_URL": "http://gms.test/chat", "LLM_MODEL": "gpt-4.1-mini", "LLM_API_KEY": "k"}
    )

    result = GmsClient.from_settings(settings).chat_json(MESSAGES)

    [req] = requests
    assert req.full_url == "http://gms.test/chat"
    assert req.get_header("Authorization") == "Bearer k"
    assert json.loads(req.data)["model"] == "gpt-4.1-mini"  # type: ignore[arg-type]
    assert result.content == {"level": 3}


def test_transport_omits_authorization_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM_API_KEY가 없으면 「Bearer None」 대신 인증 헤더 없이 호출한다."""
    requests: list[urllib.request.Request] = []

    def capture(req: urllib.request.Request, **kwargs: object) -> FakeOkResponse:
        requests.append(req)
        return FakeOkResponse()

    monkeypatch.setattr("urllib.request.urlopen", capture)

    urllib_transport("http://gms.test/chat", None)({})

    [req] = requests
    assert req.get_header("Authorization") is None


class FakeOkResponse:
    status = 200
    headers: dict[str, str] = {}

    def __enter__(self) -> "FakeOkResponse":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def read(self) -> bytes:
        return ok().body


def _answer(messages: Sequence[Mapping[str, str]]) -> GmsResult:
    return GmsResult(content={"ok": True}, token_logprobs=None, model="gms-served")


def test_with_deadline_calls_until_deadline() -> None:
    """마감 시각과 같은 시각의 호출은 허용한다."""
    now = [0.0]
    chat = with_deadline(_answer, 10.0, lambda: now[0])

    now[0] = 10.0
    assert chat([]).content == {"ok": True}


def test_with_deadline_stops_after_deadline_without_calling() -> None:
    """마감이 지나면 BE가 FAILED로 처리하므로 GMS를 호출하지 않는다(AI 명세 5장)."""
    calls: list[Sequence[Mapping[str, str]]] = []

    def chat(messages: Sequence[Mapping[str, str]]) -> GmsResult:
        calls.append(messages)
        return _answer(messages)

    with pytest.raises(GmsDeadlineError):
        with_deadline(chat, 10.0, lambda: 10.001)([])
    assert calls == []
