import asyncio
import base64
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

from app.agent.tts import (
    ELEVENLABS_URL,
    MODEL_ID,
    OUTPUT_FORMAT,
    RETRY_DELAYS,
    VOICE_IDS,
    AlignedChar,
    ElevenLabsTTS,
    RateLimitedError,
    TtsError,
    aligned_chars,
    speech_audio,
)
from app.common.session import Persona

PCM = b"\x01\x00" * 2400  # 24kHz 기준 100ms


def body(**overrides: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "audio_base64": base64.b64encode(PCM).decode(),
        "alignment": {
            "characters": ["질", "문"],
            "character_start_times_seconds": [0.0, 0.1234],
            "character_end_times_seconds": [0.1234, 0.25],
        },
        "normalized_alignment": {
            "characters": ["x"],
            "character_start_times_seconds": [0.0],
            "character_end_times_seconds": [9.0],
        },
    }
    value.update(overrides)
    return value


def test_alignment_seconds_become_milliseconds_of_original_text() -> None:
    audio = speech_audio(body())
    assert audio.pcm == PCM
    assert audio.duration_ms == 100
    # 화면의 질문 글과 글자가 맞도록 normalized_alignment가 아니라 alignment를 쓴다
    assert audio.chars == (AlignedChar("질", 0, 123), AlignedChar("문", 123, 250))
    assert audio.chars[0].to_json() == {"char": "질", "startMs": 0, "endMs": 123}


def test_alignment_never_goes_backwards_or_below_zero() -> None:
    chars = aligned_chars(
        {
            "characters": ["a"],
            "character_start_times_seconds": [-0.01],
            "character_end_times_seconds": [-0.02],
        }
    )
    assert chars == (AlignedChar("a", 0, 0),)


def test_missing_alignment_keeps_audio_without_timing() -> None:
    assert speech_audio(body(alignment=None)).chars == ()


@pytest.mark.parametrize(
    "alignment",
    [
        {"characters": ["a"], "character_start_times_seconds": [0.0]},
        {
            "characters": ["a", "b"],
            "character_start_times_seconds": [0.0],
            "character_end_times_seconds": [0.1],
        },
        {
            "characters": [1],
            "character_start_times_seconds": [0.0],
            "character_end_times_seconds": [0.1],
        },
        {
            "characters": ["a"],
            "character_start_times_seconds": [True],
            "character_end_times_seconds": [0.1],
        },
        {"characters": "a", "character_start_times_seconds": [], "character_end_times_seconds": []},
        ["a"],
    ],
)
def test_malformed_alignment_is_rejected(alignment: object) -> None:
    malformed = body(alignment=alignment)
    with pytest.raises(TtsError):
        speech_audio(malformed)


@pytest.mark.parametrize(
    "response",
    [
        [],
        body(audio_base64=None),
        body(audio_base64="***"),
        body(audio_base64=""),
        body(audio_base64=base64.b64encode(b"\x01").decode()),
    ],
)
def test_malformed_audio_is_rejected(response: object) -> None:
    with pytest.raises(TtsError):
        speech_audio(response)


def http_response(status: int, payload: object) -> MagicMock:
    response = MagicMock(status=status)
    response.json = AsyncMock(return_value=payload)
    response.__aenter__ = AsyncMock(return_value=response)
    response.__aexit__ = AsyncMock(return_value=False)
    return response


def http_session(status: int, payload: object) -> tuple[MagicMock, MagicMock]:
    response = http_response(status, payload)
    session = MagicMock()
    session.post = MagicMock(return_value=response)
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session, response


def rate_limited(reason: str = "too_many_concurrent_requests") -> MagicMock:
    return http_response(429, {"detail": {"status": reason, "message": "limit"}})


class FakeSleep:
    """다시 요청하기 전 대기를 실제로 기다리지 않고 기록한다."""

    def __init__(self) -> None:
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


def test_synthesize_requests_pcm_with_timestamps_for_persona_voice() -> None:
    session, _ = http_session(200, body())
    with patch("app.agent.tts.aiohttp.ClientSession", return_value=session):
        audio = asyncio.run(ElevenLabsTTS("secret").synthesize("질문", Persona.COFFEE_CHAT))
    assert audio.pcm == PCM
    session.post.assert_called_once_with(
        ELEVENLABS_URL.format(voice_id=VOICE_IDS[Persona.COFFEE_CHAT]),
        params={"output_format": OUTPUT_FORMAT},
        headers={"xi-api-key": "secret"},
        json={"text": "질문", "model_id": MODEL_ID},
    )


def test_error_status_does_not_expose_body() -> None:
    session, response = http_session(401, {"detail": "질문 원문"})
    synthesizing = ElevenLabsTTS("secret").synthesize("질문 원문", Persona.DEVIL)
    with (
        patch("app.agent.tts.aiohttp.ClientSession", return_value=session),
        pytest.raises(TtsError, match="status=401") as raised,
    ):
        asyncio.run(synthesizing)
    assert "질문 원문" not in str(raised.value)
    response.json.assert_not_awaited()


# 기준: ElevenLabs 도움말 API Error Code 429(잠시 뒤 다시 요청하면 대개 성공)
def test_rate_limited_request_is_retried_after_waiting() -> None:
    session, _ = http_session(200, body())
    session.post.side_effect = [
        rate_limited(),
        rate_limited("system_busy"),
        http_response(200, body()),
    ]
    sleep = FakeSleep()
    with patch("app.agent.tts.aiohttp.ClientSession", return_value=session):
        audio = asyncio.run(ElevenLabsTTS("secret", sleep=sleep).synthesize("질문", Persona.DEVIL))
    assert audio.pcm == PCM
    assert session.post.call_count == 3
    assert sleep.delays == list(RETRY_DELAYS[:2])


def test_rate_limit_that_persists_fails_after_every_retry() -> None:
    session, _ = http_session(200, body())
    session.post.side_effect = [rate_limited() for _ in range(len(RETRY_DELAYS) + 1)]
    sleep = FakeSleep()
    synthesizing = ElevenLabsTTS("secret", sleep=sleep).synthesize("질문", Persona.DEVIL)
    with (
        patch("app.agent.tts.aiohttp.ClientSession", return_value=session),
        pytest.raises(RateLimitedError, match="status=429, too_many_concurrent_requests"),
    ):
        asyncio.run(synthesizing)
    assert session.post.call_count == len(RETRY_DELAYS) + 1
    assert sleep.delays == list(RETRY_DELAYS)


def test_other_errors_are_not_retried() -> None:
    session, _ = http_session(401, {"detail": "invalid key"})
    sleep = FakeSleep()
    synthesizing = ElevenLabsTTS("secret", sleep=sleep).synthesize("질문", Persona.DEVIL)
    with (
        patch("app.agent.tts.aiohttp.ClientSession", return_value=session),
        pytest.raises(TtsError, match="status=401"),
    ):
        asyncio.run(synthesizing)
    session.post.assert_called_once()
    assert sleep.delays == []


# 429 본문에서는 detail.status 형식의 값만 쓰고, 그 밖의 값은 요청 글이 섞일 수 있어 버린다
@pytest.mark.parametrize(
    "payload", [{"detail": "질문 원문"}, {"detail": {"status": "질문 원문"}}, None, ["x"]]
)
def test_rate_limit_reason_never_exposes_body(payload: object) -> None:
    session, _ = http_session(429, payload)
    synthesizing = ElevenLabsTTS("secret", sleep=FakeSleep()).synthesize("질문 원문", Persona.DEVIL)
    with (
        patch("app.agent.tts.aiohttp.ClientSession", return_value=session),
        pytest.raises(RateLimitedError) as raised,
    ):
        asyncio.run(synthesizing)
    assert raised.value.reason == "unknown"
    assert "질문 원문" not in str(raised.value)


@pytest.mark.parametrize(
    "error", [aiohttp.ClientConnectionError("down"), TimeoutError(), ValueError("json")]
)
def test_network_and_decode_failures_become_tts_error(error: Exception) -> None:
    session, response = http_session(200, None)
    response.json = AsyncMock(side_effect=error)
    synthesizing = ElevenLabsTTS("secret").synthesize("질문", Persona.DEVIL)
    with (
        patch("app.agent.tts.aiohttp.ClientSession", return_value=session),
        pytest.raises(TtsError),
    ):
        asyncio.run(synthesizing)


def test_missing_key_fails_without_calling_elevenlabs() -> None:
    tts = ElevenLabsTTS(None)
    assert not tts.configured
    synthesizing = tts.synthesize("질문", Persona.DEVIL)
    with (
        patch("app.agent.tts.aiohttp.ClientSession") as factory,
        pytest.raises(TtsError, match="ELEVENLABS_API_KEY"),
    ):
        asyncio.run(synthesizing)
    factory.assert_not_called()


def test_every_persona_has_voice() -> None:
    assert set(VOICE_IDS) == set(Persona)
