import asyncio
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import aiohttp
import pytest

from app.agent.stt import SAMPLE_RATE, SONIOX_URL, SonioxSTT, SttError, SttSettings, SttToken


def test_final_tokens_accumulate_while_interim_is_replaced() -> None:
    stt = SonioxSTT(SttSettings("secret"))
    assert not stt.accept_response({"tokens": [{"text": "안녕", "is_final": False}]})
    assert stt.text == ""
    assert stt.interim_text == "안녕"
    stt.accept_response(
        {
            "tokens": [
                {"text": "안녕하세요", "is_final": True, "start_ms": 100, "end_ms": 800},
                {"text": " 저", "is_final": False},
            ]
        }
    )
    stt.accept_response(
        {
            "tokens": [
                {"text": " 저는", "is_final": True, "start_ms": 900, "end_ms": 1200},
                {"text": " 개발자", "is_final": False},
            ]
        }
    )
    assert stt.text == "안녕하세요 저는"
    assert stt.interim_text == " 개발자"
    assert stt.tokens == [SttToken("안녕하세요", 100, 800), SttToken(" 저는", 900, 1200)]


def test_control_tokens_are_excluded_and_missing_timing_is_preserved() -> None:
    stt = SonioxSTT(SttSettings("secret"))
    assert stt.accept_response(
        {
            "tokens": [
                {"text": "답변", "is_final": True, "start_ms": 10, "end_ms": 40},
                {"text": ".", "is_final": True},
                {"text": "<end>", "is_final": True},
                {"text": "<fin>", "is_final": False},
            ],
            "finished": True,
        }
    )
    assert stt.text == "답변."
    assert stt.tokens[-1] == SttToken(".", None, None)
    assert stt.interim_text == ""


def test_updates_include_replacement_interim_and_preserve_confirmed_timings() -> None:
    updates = Mock()
    stt = SonioxSTT(SttSettings("secret"), on_update=updates)
    stt.accept_response({"tokens": [{"text": "안녕", "is_final": False}]})
    stt.accept_response({"tokens": [{"text": "안녕하세요", "is_final": False}]})
    stt.accept_response(
        {
            "tokens": [
                {"text": "안녕하세요", "is_final": True, "start_ms": 10, "end_ms": 500},
                {"text": " 저는", "is_final": False},
            ]
        }
    )
    stt.accept_response({"tokens": [{"text": " 저는", "is_final": True}], "finished": True})
    assert [call.args for call in updates.call_args_list] == [
        ("", "안녕"),
        ("", "안녕하세요"),
        ("안녕하세요", " 저는"),
        ("안녕하세요 저는", ""),
    ]
    assert stt.tokens[0] == SttToken("안녕하세요", 10, 500)


@pytest.mark.parametrize("env", [{}, {"SONIOX_API_KEY": "  "}])
def test_settings_require_key(env: dict[str, str]) -> None:
    with pytest.raises(SttError, match="SONIOX_API_KEY"):
        SttSettings.from_env(env)


def test_settings_strip_key_without_exposing_it_in_repr() -> None:
    settings = SttSettings.from_env(
        {"SONIOX_API_KEY": " private-key ", "SONIOX_STT_MODEL": "custom"}
    )
    assert settings.api_key == "private-key"
    assert settings.model == "custom"
    assert "private-key" not in repr(settings)


def test_provider_error_does_not_expose_response_text() -> None:
    with pytest.raises(SttError, match="code=401") as error:
        SonioxSTT(SttSettings("secret")).accept_response(
            {"error_code": 401, "error_message": "sensitive transcript"}
        )
    assert "sensitive transcript" not in str(error.value)


class FakeWebSocket:
    def __init__(self) -> None:
        self.messages: asyncio.Queue[Any] = asyncio.Queue()
        self.send_json = AsyncMock()
        self.send_bytes = AsyncMock()
        self.send_str = AsyncMock(side_effect=self.finish)
        self.exited = False

    async def __aenter__(self) -> "FakeWebSocket":
        return self

    async def __aexit__(self, *args: Any) -> None:
        self.exited = True

    def __aiter__(self) -> "FakeWebSocket":
        return self

    async def __anext__(self) -> Any:
        message = await self.messages.get()
        if message is None:
            raise StopAsyncIteration
        return message

    async def finish(self, text: str) -> None:
        self.messages.put_nowait(
            Mock(
                type=aiohttp.WSMsgType.TEXT,
                json=Mock(
                    return_value={
                        "tokens": [
                            {"text": "마지막", "is_final": True, "start_ms": 0, "end_ms": 50}
                        ],
                        "finished": True,
                    }
                ),
            )
        )


def mock_session(ws: FakeWebSocket) -> Any:
    session = Mock()
    session.ws_connect.return_value = ws
    context = AsyncMock()
    context.__aenter__.return_value = session
    return session, context


def test_stream_sends_pcm_then_end_and_collects_final_flush() -> None:
    async def run() -> None:
        ws = FakeWebSocket()
        session, context = mock_session(ws)

        async def audio() -> AsyncIterator[bytes]:
            yield b"\x00\x01"
            yield b"\x02\x03"

        stt = SonioxSTT(SttSettings("secret"))
        with patch("app.agent.stt.aiohttp.ClientSession", return_value=context):
            await asyncio.wait_for(stt.run(audio()), timeout=1)
        assert session.ws_connect.call_args.args == (SONIOX_URL,)
        assert session.ws_connect.call_args.kwargs["headers"] == {"Authorization": "Bearer secret"}
        configuration = ws.send_json.call_args.args[0]
        assert configuration["audio_format"] == "pcm_s16le"
        assert configuration["sample_rate"] == SAMPLE_RATE
        assert configuration["num_channels"] == 1
        assert [call.args[0] for call in ws.send_bytes.await_args_list] == [
            b"\x00\x01",
            b"\x02\x03",
        ]
        ws.send_str.assert_awaited_once_with("")
        assert stt.tokens == [SttToken("마지막", 0, 50)]
        assert ws.exited
        context.__aexit__.assert_awaited_once()

    asyncio.run(run())


@pytest.mark.parametrize("server_result", ["error", "closed", "finished"])
def test_server_failure_or_early_finish_cancels_audio_and_closes_socket(server_result: str) -> None:
    async def run() -> None:
        ws = FakeWebSocket()
        _, context = mock_session(ws)
        audio_started = asyncio.Event()
        audio_closed = asyncio.Event()

        async def audio() -> AsyncIterator[bytes]:
            audio_started.set()
            try:
                await asyncio.Event().wait()
                yield b"unreachable"
            finally:
                audio_closed.set()

        async def reply() -> None:
            await audio_started.wait()
            if server_result == "closed":
                ws.messages.put_nowait(None)
            elif server_result == "error":
                ws.messages.put_nowait(Mock(type=aiohttp.WSMsgType.ERROR))
            else:
                ws.messages.put_nowait(
                    Mock(type=aiohttp.WSMsgType.TEXT, json=Mock(return_value={"finished": True}))
                )

        with patch("app.agent.stt.aiohttp.ClientSession", return_value=context):
            response_task = asyncio.create_task(reply())
            with pytest.raises(SttError):
                await asyncio.wait_for(SonioxSTT(SttSettings("secret")).run(audio()), timeout=1)
            await response_task
        assert audio_closed.is_set()
        assert ws.exited
        context.__aexit__.assert_awaited_once()

    asyncio.run(run())


def test_audio_failure_closes_connection_and_preserves_error() -> None:
    async def run() -> None:
        ws = FakeWebSocket()
        _, context = mock_session(ws)

        async def audio() -> AsyncIterator[bytes]:
            yield b"audio"
            raise ValueError("audio source failed")

        with (
            patch("app.agent.stt.aiohttp.ClientSession", return_value=context),
            pytest.raises(ValueError, match="audio source failed"),
        ):
            await asyncio.wait_for(SonioxSTT(SttSettings("secret")).run(audio()), timeout=1)
        assert ws.exited
        ws.send_str.assert_not_awaited()

    asyncio.run(run())
