import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import aiohttp
import pytest

from app.agent.stt import (
    SAMPLE_RATE,
    SONIOX_URL,
    SonioxSTT,
    SttError,
    SttSettings,
    SttState,
)
from app.common.answer import SpeechToken, SttGap


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
    assert stt.transcript.answer_tokens() == (
        SpeechToken("안녕하세요", 100, 800),
        SpeechToken(" 저는", 900, 1200),
    )


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
    assert stt.transcript.final_count == 2
    # 시각 없는 토큰도 글은 보존하고,
    # 답변 토큰(tokens)은 범위(AI 명세 6.2)를 벗어나므로 생성하지 않는다
    assert stt.transcript.answer_tokens() is None
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
    stt.accept_response(
        {
            "tokens": [{"text": " 저는", "is_final": True, "start_ms": 600, "end_ms": 900}],
            "finished": True,
        }
    )
    assert [call.args for call in updates.call_args_list] == [
        ("", "안녕"),
        ("", "안녕하세요"),
        ("안녕하세요", " 저는"),
        ("안녕하세요 저는", ""),
    ]
    assert stt.transcript.answer_tokens() == (
        SpeechToken("안녕하세요", 10, 500),
        SpeechToken(" 저는", 600, 900),
    )


def test_confirmed_text_for_screen_keeps_spaces() -> None:
    """화면은 확정 글 뒤에 미확정 글을 이어 표시하므로 확정 글의 공백을 제거하지 않는다."""
    updates = Mock()
    stt = SonioxSTT(SttSettings("secret"), on_update=updates)
    stt.accept_response(
        {"tokens": [{"text": " 네", "is_final": True}, {"text": " ", "is_final": True}]}
    )

    assert stt.text == " 네 "
    assert updates.call_args.args == (" 네 ", "")


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
    stt = SonioxSTT(SttSettings("secret"))
    with pytest.raises(SttError, match="code=401") as error:
        stt.accept_response({"error_code": 401, "error_message": "sensitive transcript"})
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
        assert stt.transcript.answer_tokens() == (SpeechToken("마지막", 0, 50),)
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
            # 다시 연결하지 않도록 재연결 횟수를 0으로 두고, 연결을 정리하는지만 확인한다
            stt = SonioxSTT(SttSettings("secret"), reconnect_delays=())
            running = stt.run(audio())
            with pytest.raises(SttError):
                await asyncio.wait_for(running, timeout=1)
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

        running = SonioxSTT(SttSettings("secret")).run(audio())
        with (
            patch("app.agent.stt.aiohttp.ClientSession", return_value=context),
            pytest.raises(ValueError, match="audio source failed"),
        ):
            await asyncio.wait_for(running, timeout=1)
        assert ws.exited
        ws.send_str.assert_not_awaited()

    asyncio.run(run())


def test_endpoint_processing_time_is_kept_only_for_endpoint_response() -> None:
    seen: list[float | None] = []
    stt = SonioxSTT(
        SttSettings("secret"),
        on_update=lambda _confirmed, _interim: seen.append(stt.endpoint_proc_ms),
    )
    stt.accept_response(
        {
            "tokens": [{"text": "답변이에요.", "is_final": True, "start_ms": 0, "end_ms": 900}],
            "total_audio_proc_ms": 1200,
        }
    )
    stt.accept_response(
        {"tokens": [{"text": "<end>", "is_final": True}], "total_audio_proc_ms": 1500}
    )
    stt.accept_response({"tokens": [], "total_audio_proc_ms": 1800})
    # 문장 끝 판단이 on_update에서 읽을 수 있도록 호출 전에 갱신한다
    assert seen == [None, 1500.0, None]


# 100ms 분량(16kHz·16비트·모노)의 음성 조각
CHUNK = b"\x00\x00" * 1600


def text_message(tokens: list[dict[str, Any]]) -> Any:
    return Mock(type=aiohttp.WSMsgType.TEXT, json=Mock(return_value={"tokens": tokens}))


def answering_socket(token: str) -> FakeWebSocket:
    """음성 조각을 수신할 때마다 0~50ms 토큰 하나로 응답하는 연결."""
    ws = FakeWebSocket()

    async def reply(_chunk: bytes) -> None:
        ws.messages.put_nowait(
            text_message([{"text": token, "is_final": True, "start_ms": 0, "end_ms": 50}])
        )

    ws.send_bytes = AsyncMock(side_effect=reply)
    return ws


def contexts(*sockets: FakeWebSocket) -> list[Any]:
    return [mock_session(ws)[1] for ws in sockets]


def opened(ws: FakeWebSocket, event: asyncio.Event) -> Any:
    """연결을 시작하면 event를 설정하는 연결 정보. 시험이 시간 대신 연결 시점을 기다리게 한다."""
    session, context = mock_session(ws)

    def enter(*_args: Any) -> Any:
        event.set()
        return session

    context.__aenter__.side_effect = enter
    return context


def test_reconnects_drops_audio_meanwhile_and_continues_timing() -> None:
    """AI 명세 6.5: 끊기면 다시 연결하고, 그동안의 음성은 전송하지 않으며 시각은 이어서 계산한다."""

    async def run() -> None:
        first = FakeWebSocket()

        async def first_reply(_chunk: bytes) -> None:
            first.messages.put_nowait(
                text_message([{"text": "앞", "is_final": True, "start_ms": 0, "end_ms": 50}])
            )
            # 응답 하나 뒤 연결이 끊긴다
            first.messages.put_nowait(None)

        first.send_bytes = AsyncMock(side_effect=first_reply)
        second = answering_socket("뒤")
        reconnecting = asyncio.Event()
        reconnected = asyncio.Event()
        states: list[SttState] = []

        def on_state(state: SttState) -> None:
            states.append(state)
            (reconnecting if state is SttState.RECONNECTING else reconnected).set()

        second_opened = asyncio.Event()

        async def audio() -> AsyncIterator[bytes]:
            yield b"\x01\x00" * 1600
            await reconnecting.wait()
            # 다시 연결을 기다리는 동안(0.5초) 읽은 음성이다
            yield b"\x02\x00" * 1600
            await second_opened.wait()
            yield b"\x03\x00" * 1600
            # 새 연결이 첫 응답을 전송해야 다시 연결된 것으로 간주한다
            await reconnected.wait()

        stt = SonioxSTT(SttSettings("secret"), on_state=on_state, reconnect_delays=(0.5,))
        sessions = [contexts(first)[0], opened(second, second_opened)]
        with patch("app.agent.stt.aiohttp.ClientSession", side_effect=sessions):
            await asyncio.wait_for(stt.run(audio()), timeout=2)
        assert states == [SttState.RECONNECTING, SttState.RECONNECTED]
        assert [call.args[0][:2] for call in first.send_bytes.await_args_list] == [b"\x01\x00"]
        assert [call.args[0][:2] for call in second.send_bytes.await_args_list] == [b"\x03\x00"]
        # 새 연결의 시각은 그 연결로 처음 전송한 음성 위치(200ms)부터다
        assert stt.transcript.answer_tokens() == (
            SpeechToken("앞", 0, 50),
            SpeechToken(" 뒤", 200, 250),
            SpeechToken("마지막", 200, 250),
        )
        # 끊긴 연결의 마지막 응답(100ms)부터 새 연결로 전송을 다시 시작한 위치(200ms)까지
        assert stt.gaps == (SttGap(100, 200),)
        assert first.exited
        assert second.exited

    asyncio.run(run())


def test_no_response_while_sending_audio_reconnects(caplog: pytest.LogCaptureFixture) -> None:
    """음성을 전송했는데 응답이 없으면 연결이 멈춘 것으로 간주한다."""

    async def run() -> None:
        silent = FakeWebSocket()
        states: list[SttState] = []

        async def audio() -> AsyncIterator[bytes]:
            while True:
                yield CHUNK
                await asyncio.sleep(0.01)

        stt = SonioxSTT(
            SttSettings("secret"),
            on_state=states.append,
            reconnect_delays=(),
            no_response_seconds=0.1,
        )
        running = stt.run(audio())
        with (
            patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(silent)),
            pytest.raises(SttError) as error,
        ):
            await asyncio.wait_for(running, timeout=2)
        assert str(error.value.__cause__) == "no_response"
        assert states == [SttState.RECONNECTING]
        assert len(stt.gaps) == 1
        assert silent.exited

    with caplog.at_level(logging.INFO, logger="app.agent.stt"):
        asyncio.run(run())
    record = summary(caplog)
    # 음성은 전송했으나 응답이 없었다(Soniox 무응답)
    assert record["levelno"] == logging.WARNING
    assert (record["result"], record["responses"], record["failures"]) == (
        "reconnect_failed",
        0,
        ["no_response"],
    )
    assert record["sent_ms"] > 0


def test_no_audio_is_not_counted_as_no_response() -> None:
    """음성이 오지 않는 동안은 응답도 오지 않으므로 응답 없음으로 보지 않는다."""

    async def run() -> None:
        ws = answering_socket("말")

        async def audio() -> AsyncIterator[bytes]:
            yield CHUNK
            # 응답 없음 기준(0.3초)보다 오래 음성이 오지 않는다
            await asyncio.sleep(1.0)
            yield CHUNK

        states: list[SttState] = []
        stt = SonioxSTT(SttSettings("secret"), on_state=states.append, no_response_seconds=0.3)
        with patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(ws)):
            await asyncio.wait_for(stt.run(audio()), timeout=2)
        assert states == []
        assert stt.gaps == ()

    asyncio.run(run())


def test_connect_failure_is_retried_from_answer_start(caplog: pytest.LogCaptureFixture) -> None:
    async def run() -> None:
        refused = AsyncMock()
        refused.__aenter__.side_effect = aiohttp.ClientConnectionError("refused")
        ws = answering_socket("답")
        states: list[SttState] = []

        async def audio() -> AsyncIterator[bytes]:
            yield CHUNK
            await asyncio.sleep(0.1)
            yield CHUNK

        stt = SonioxSTT(SttSettings("secret"), on_state=states.append, reconnect_delays=(0.0,))
        with patch("app.agent.stt.aiohttp.ClientSession", side_effect=[refused, *contexts(ws)]):
            await asyncio.wait_for(stt.run(audio()), timeout=2)
        assert states == [SttState.RECONNECTING, SttState.RECONNECTED]
        # 첫 연결에 실패했으면 답변 시작(0ms)부터 인식하지 못했다
        assert stt.gaps[0].start_ms == 0

    with caplog.at_level(logging.WARNING, logger="app.agent.stt"):
        asyncio.run(run())
    # 재연결 로그의 경과 시간은 답변 시작부터 계산한다(응답을 수신한 적이 없어도)
    assert "마지막 응답 뒤 0.0초" in caplog.text


def test_answer_ending_while_waiting_to_reconnect_closes_gap() -> None:
    async def run() -> None:
        dropped = FakeWebSocket()

        async def close_after_first(_chunk: bytes) -> None:
            dropped.messages.put_nowait(None)

        dropped.send_bytes = AsyncMock(side_effect=close_after_first)

        reconnecting = asyncio.Event()

        async def audio() -> AsyncIterator[bytes]:
            yield CHUNK
            await reconnecting.wait()
            yield CHUNK

        stt = SonioxSTT(
            SttSettings("secret"),
            on_state=lambda _state: reconnecting.set(),
            reconnect_delays=(5.0,),
        )
        with patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(dropped)):
            # 다시 연결을 기다리는 동안 음성이 끝나면 더 전송할 음성이 없으므로 끝낸다
            await asyncio.wait_for(stt.run(audio()), timeout=2)
        assert stt.gaps == (SttGap(0, 200),)

    asyncio.run(run())


def test_gives_up_after_three_reconnects() -> None:
    async def run() -> None:
        sockets = [FakeWebSocket() for _ in range(4)]
        for ws in sockets:
            ws.messages.put_nowait(None)
        states: list[SttState] = []

        async def audio() -> AsyncIterator[bytes]:
            while True:
                yield CHUNK
                await asyncio.sleep(0.01)

        stt = SonioxSTT(
            SttSettings("secret"), on_state=states.append, reconnect_delays=(0.0, 0.0, 0.0)
        )
        running = stt.run(audio())
        with (
            patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(*sockets)),
            pytest.raises(SttError, match="다시 연결하지 못했습니다"),
        ):
            await asyncio.wait_for(running, timeout=2)
        # 처음 연결 1회와 다시 연결 3회로 끝낸다.
        # 연결만 되고 응답 없이 끊긴 연결은 다시 연결된 것으로 보지 않으므로 알림은 한 번이다
        assert all(ws.exited for ws in sockets)
        assert states == [SttState.RECONNECTING]
        assert len(stt.gaps) == 1

    asyncio.run(run())


def error_message(code: int) -> Any:
    return Mock(
        type=aiohttp.WSMsgType.TEXT,
        json=Mock(return_value={"error_code": code, "error_message": "rejected"}),
    )


def error_socket(code: int) -> FakeWebSocket:
    """음성 조각을 수신할 때마다 Soniox 오류를 응답하는 연결."""
    ws = FakeWebSocket()

    async def reply(_chunk: bytes) -> None:
        ws.messages.put_nowait(error_message(code))

    ws.send_bytes = AsyncMock(side_effect=reply)
    return ws


def test_gives_up_when_soniox_keeps_answering_with_errors(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """잘못된 키처럼 Soniox가 계속 오류를 응답하면 3회 다시 연결한 뒤 포기한다."""

    async def run() -> None:
        sockets = [error_socket(401) for _ in range(4)]
        states: list[SttState] = []

        async def audio() -> AsyncIterator[bytes]:
            while True:
                yield CHUNK
                await asyncio.sleep(0.01)

        stt = SonioxSTT(
            SttSettings("secret"), on_state=states.append, reconnect_delays=(0.0, 0.0, 0.0)
        )
        running = stt.run(audio())
        with (
            patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(*sockets)),
            pytest.raises(SttError, match="다시 연결하지 못했습니다"),
        ):
            await asyncio.wait_for(running, timeout=2)
        assert all(ws.exited for ws in sockets)
        assert states == [SttState.RECONNECTING]
        assert len(stt.gaps) == 1

    with caplog.at_level(logging.INFO, logger="app.agent.stt"):
        asyncio.run(run())
    record = summary(caplog)
    assert record["result"] == "reconnect_failed"
    assert record["failures"] == ["soniox_error"] * 4
    assert record["reconnects"] == 3


def test_error_response_does_not_move_gap_start() -> None:
    """인식하지 못한 구간은 오류 응답이 아니라 마지막 정상 응답부터 시작한다."""

    async def run() -> None:
        first = FakeWebSocket()
        replies = [
            text_message([{"text": "앞", "is_final": True, "start_ms": 0, "end_ms": 50}]),
            error_message(503),
        ]

        async def reply(_chunk: bytes) -> None:
            if replies:
                first.messages.put_nowait(replies.pop(0))

        first.send_bytes = AsyncMock(side_effect=reply)
        healthy = answering_socket("뒤")
        states: list[SttState] = []

        async def audio() -> AsyncIterator[bytes]:
            yield CHUNK
            await asyncio.sleep(0.05)
            yield CHUNK
            while SttState.RECONNECTED not in states:
                yield CHUNK
                await asyncio.sleep(0.01)

        stt = SonioxSTT(
            SttSettings("secret"), on_state=states.append, reconnect_delays=(0.0, 0.0, 0.0)
        )
        with patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(first, healthy)):
            await asyncio.wait_for(stt.run(audio()), timeout=2)
        assert states == [SttState.RECONNECTING, SttState.RECONNECTED]
        # 정상 응답은 첫 음성 조각(100ms)까지이고, 두 번째 조각에는 오류를 응답했다
        assert stt.gaps[0].start_ms == 100

    asyncio.run(run())


def test_connection_dropping_before_first_response_counts_as_same_outage() -> None:
    async def run() -> None:
        first = FakeWebSocket()

        async def first_reply(_chunk: bytes) -> None:
            first.messages.put_nowait(
                text_message([{"text": "앞", "is_final": True, "start_ms": 0, "end_ms": 50}])
            )
            first.messages.put_nowait(None)

        first.send_bytes = AsyncMock(side_effect=first_reply)
        # 연결만 되고 응답 없이 바로 끊긴다
        flaky = FakeWebSocket()
        flaky.messages.put_nowait(None)
        healthy = answering_socket("뒤")
        states: list[SttState] = []

        async def audio() -> AsyncIterator[bytes]:
            yield CHUNK
            while SttState.RECONNECTING not in states:
                await asyncio.sleep(0.01)
            while SttState.RECONNECTED not in states:
                yield CHUNK
                await asyncio.sleep(0.01)

        stt = SonioxSTT(
            SttSettings("secret"), on_state=states.append, reconnect_delays=(0.0, 0.0, 0.0)
        )
        with patch(
            "app.agent.stt.aiohttp.ClientSession", side_effect=contexts(first, flaky, healthy)
        ):
            await asyncio.wait_for(stt.run(audio()), timeout=2)
        assert states == [SttState.RECONNECTING, SttState.RECONNECTED]
        assert len(stt.gaps) == 1
        assert stt.gaps[0].start_ms == 100

    asyncio.run(run())


def test_interim_text_before_drop_is_kept_in_answer() -> None:
    """Soniox는 말한 뒤 몇 초가 지나야 확정하므로, 끊기기 직전의 미확정 글도 답변에 남긴다."""

    async def run() -> None:
        first = FakeWebSocket()

        async def interim_then_drop(_chunk: bytes) -> None:
            first.messages.put_nowait(
                text_message(
                    [{"text": "끊기기 전", "is_final": False, "start_ms": 0, "end_ms": 90}]
                )
            )
            first.messages.put_nowait(None)

        first.send_bytes = AsyncMock(side_effect=interim_then_drop)
        updates: list[tuple[str, str]] = []
        reconnecting = asyncio.Event()

        async def audio() -> AsyncIterator[bytes]:
            yield CHUNK
            # 다시 연결을 기다리는 동안 답변이 끝난다
            await reconnecting.wait()

        stt = SonioxSTT(
            SttSettings("secret"),
            on_update=lambda confirmed, interim: updates.append((confirmed, interim)),
            on_state=lambda _state: reconnecting.set(),
            reconnect_delays=(5.0,),
        )
        with patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(first)):
            await asyncio.wait_for(stt.run(audio()), timeout=2)
        assert stt.transcript.content() == "끊기기 전"
        assert stt.transcript.answer_tokens() == (SpeechToken("끊기기 전", 0, 90),)
        # 화면 자막도 확정 글로 변경된다
        assert updates[-1] == ("끊기기 전", "")

    asyncio.run(run())


def test_interim_text_is_kept_when_closed_before_final_response() -> None:
    """답변을 끝낸 뒤 종료 응답 전에 연결이 끊겨도 미확정 글을 답변에 남긴다."""

    async def run() -> None:
        ws = FakeWebSocket()

        async def interim(_chunk: bytes) -> None:
            ws.messages.put_nowait(
                text_message(
                    [{"text": "마지막 말", "is_final": False, "start_ms": 0, "end_ms": 80}]
                )
            )

        async def closed(_text: str) -> None:
            ws.messages.put_nowait(None)

        ws.send_bytes = AsyncMock(side_effect=interim)
        ws.send_str = AsyncMock(side_effect=closed)

        async def audio() -> AsyncIterator[bytes]:
            yield CHUNK

        stt = SonioxSTT(SttSettings("secret"))
        running = stt.run(audio())
        with (
            patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(ws)),
            pytest.raises(SttError),
        ):
            await asyncio.wait_for(running, timeout=2)
        assert stt.transcript.content() == "마지막 말"

    asyncio.run(run())


def summary(caplog: pytest.LogCaptureFixture) -> dict[str, Any]:
    """답변이 끝날 때 남기는 요약 로그 한 줄의 필드."""
    [record] = [r for r in caplog.records if r.getMessage().startswith("Soniox STT 답변 종료")]
    return vars(record)


def test_summary_log_reports_audio_read_sent_and_responses(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """답변이 끝나면 읽은·전송한 음성 길이와 응답 수를 요약 로그에 남긴다."""

    async def run() -> None:
        ws = answering_socket("말")

        async def audio() -> AsyncIterator[bytes]:
            for _ in range(3):
                yield CHUNK

        stt = SonioxSTT(SttSettings("secret"))
        with patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(ws)):
            await asyncio.wait_for(stt.run(audio()), timeout=2)

    with caplog.at_level(logging.INFO, logger="app.agent.stt"):
        asyncio.run(run())
    record = summary(caplog)
    assert record["levelno"] == logging.INFO
    assert record["result"] == "completed"
    # 음성 조각 3개(각 100ms)를 모두 전송했고, 조각마다 한 번과 종료 응답 한 번을 수신했다
    assert (record["audio_ms"], record["sent_ms"], record["responses"]) == (300, 300, 4)
    assert record["final_tokens"] == 4
    assert (record["reconnects"], record["gap_ms"], record["failures"]) == (0, 0, [])
    assert record["first_audio_ms"] is not None
    assert record["first_response_ms"] is not None
    assert "error" not in record


def test_reconnect_reasons_are_classified(caplog: pytest.LogCaptureFixture) -> None:
    """같은 끊김이라도 Soniox 오류 응답·서버의 연결 종료·연결 실패를 구분해 남긴다."""

    async def run() -> None:
        rejecting = FakeWebSocket()

        async def error_reply(_chunk: bytes) -> None:
            rejecting.messages.put_nowait(
                Mock(
                    type=aiohttp.WSMsgType.TEXT,
                    json=Mock(return_value={"error_code": 503, "error_message": "busy"}),
                )
            )

        rejecting.send_bytes = AsyncMock(side_effect=error_reply)
        closing = FakeWebSocket()
        closing.messages.put_nowait(None)
        refused = AsyncMock()
        refused.__aenter__.side_effect = aiohttp.ClientConnectionError("refused")
        healthy = answering_socket("뒤")
        states: list[SttState] = []

        async def audio() -> AsyncIterator[bytes]:
            while SttState.RECONNECTED not in states:
                yield CHUNK
                await asyncio.sleep(0.01)

        stt = SonioxSTT(
            SttSettings("secret"), on_state=states.append, reconnect_delays=(0.0, 0.0, 0.0)
        )
        sessions = [*contexts(rejecting, closing), refused, *contexts(healthy)]
        with patch("app.agent.stt.aiohttp.ClientSession", side_effect=sessions):
            await asyncio.wait_for(stt.run(audio()), timeout=2)

    with caplog.at_level(logging.INFO, logger="app.agent.stt"):
        asyncio.run(run())
    reconnects = [vars(r) for r in caplog.records if hasattr(r, "reason")]
    assert [(r["reason"], r["detail"]) for r in reconnects] == [
        ("soniox_error", "code=503"),
        ("closed", ""),
        ("connect_failed", "ClientConnectionError"),
    ]
    record = summary(caplog)
    assert record["result"] == "completed"
    assert record["failures"] == ["soniox_error", "closed", "connect_failed"]
    assert record["reconnects"] == 3


def test_send_failure_is_classified(caplog: pytest.LogCaptureFixture) -> None:
    async def run() -> None:
        ws = FakeWebSocket()
        ws.send_bytes = AsyncMock(side_effect=aiohttp.ClientConnectionError("reset"))

        async def audio() -> AsyncIterator[bytes]:
            while True:
                yield CHUNK
                await asyncio.sleep(0.01)

        stt = SonioxSTT(SttSettings("secret"), reconnect_delays=())
        running = stt.run(audio())
        with (
            patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(ws)),
            pytest.raises(SttError),
        ):
            await asyncio.wait_for(running, timeout=2)

    with caplog.at_level(logging.INFO, logger="app.agent.stt"):
        asyncio.run(run())
    record = summary(caplog)
    assert (record["result"], record["failures"], record["sent_ms"]) == (
        "reconnect_failed",
        ["send_failed"],
        0,
    )


def test_audio_failure_is_reported_apart_from_stt_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """지원자 음성을 읽지 못한 실패는 Soniox 실패와 구분한다."""

    async def run() -> None:
        ws = answering_socket("말")

        async def audio() -> AsyncIterator[bytes]:
            yield CHUNK
            await asyncio.sleep(0.05)
            raise RuntimeError("track ended")

        stt = SonioxSTT(SttSettings("secret"))
        running = stt.run(audio())
        with (
            patch("app.agent.stt.aiohttp.ClientSession", side_effect=contexts(ws)),
            pytest.raises(RuntimeError),
        ):
            await asyncio.wait_for(running, timeout=2)

    with caplog.at_level(logging.INFO, logger="app.agent.stt"):
        asyncio.run(run())
    record = summary(caplog)
    assert record["levelno"] == logging.WARNING
    assert (record["result"], record["error"], record["audio_ms"]) == (
        "audio_failed",
        "RuntimeError",
        100,
    )


def test_cancelled_listening_is_not_reported_as_failure(caplog: pytest.LogCaptureFixture) -> None:
    """듣기를 취소하면 경고가 아닌 INFO로 남긴다."""

    async def run() -> None:
        ws = answering_socket("말")
        opened_event = asyncio.Event()

        async def audio() -> AsyncIterator[bytes]:
            yield CHUNK
            await asyncio.Event().wait()

        stt = SonioxSTT(SttSettings("secret"))
        with patch("app.agent.stt.aiohttp.ClientSession", side_effect=[opened(ws, opened_event)]):
            task = asyncio.create_task(stt.run(audio()))
            await opened_event.wait()
            await asyncio.sleep(0.05)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    with caplog.at_level(logging.INFO, logger="app.agent.stt"):
        asyncio.run(run())
    record = summary(caplog)
    assert (record["levelno"], record["result"]) == (logging.INFO, "cancelled")
