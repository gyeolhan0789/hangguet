import asyncio
from collections.abc import AsyncIterator, Callable
from datetime import datetime, timedelta
from typing import Any
from unittest.mock import Mock, patch

import pytest

from app.agent.capture import AnswerCapture
from app.agent.stt import SttSettings
from app.common.answer import SpeechToken
from app.common.results import KST
from app.interview.realtime.transcript import SonioxToken, Transcript

# 기준: AI 명세 6.2(답변마다 듣기 시작한 시각이 tokens의 0ms) · 6.3 interview.stt · 6.5(STT 오류)
# LiveKit 음성 스트림 · 화면 자막 전송 · Soniox는 대역으로 바꾼다.

OPENED = datetime(2026, 10, 26, 15, 0, 0, tzinfo=KST)


class Clock:
    def __init__(self) -> None:
        self.now = OPENED

    def __call__(self) -> datetime:
        return self.now


class FakeStream:
    """테스트가 넣는 프레임을 내보내는 음성 스트림."""

    def __init__(self) -> None:
        self.frames: asyncio.Queue[bytes] = asyncio.Queue()
        self.closed = 0

    def __aiter__(self) -> AsyncIterator[Any]:
        return self

    async def __anext__(self) -> Any:
        data = await self.frames.get()
        return Mock(frame=Mock(data=data))

    async def aclose(self) -> None:
        self.closed += 1


class FakeStt:
    """보낸 음성을 모으고, 테스트가 정하면 실패하거나 끝나기 전에 응답을 반영한다."""

    def __init__(self, _settings: SttSettings, *, on_update: Callable[[str, str], None]) -> None:
        self.on_update = on_update
        self.transcript = Transcript()
        self.transcript.begin_connection(0)
        self.sent: list[bytes] = []
        self.fail = asyncio.Event()
        self.fail_on_finish = False
        self.finished = False

    def respond(self, *tokens: SonioxToken) -> None:
        self.transcript.apply(tokens)
        self.on_update(self.transcript.confirmed_text, self.transcript.interim_text)

    async def run(self, audio: AsyncIterator[bytes]) -> None:
        reading = asyncio.ensure_future(self._read(audio))
        failing = asyncio.create_task(self.fail.wait())
        try:
            await asyncio.wait((reading, failing), return_when=asyncio.FIRST_COMPLETED)
            if failing.done():
                raise RuntimeError("Soniox 오류")
            if self.fail_on_finish:
                raise RuntimeError("종료 응답 전 오류")
            # 남은 음성을 확정하는 종료 응답
            self.respond(SonioxToken("다", 300, 400, True))
            self.finished = True
        finally:
            reading.cancel()
            failing.cancel()
            await asyncio.gather(reading, failing, return_exceptions=True)

    async def _read(self, audio: AsyncIterator[bytes]) -> None:
        async for chunk in audio:
            self.sent.append(chunk)


async def settle() -> None:
    for _ in range(20):
        await asyncio.sleep(0)


class Opened:
    def __init__(self) -> None:
        self.clock = Clock()
        self.stream = FakeStream()
        self.publisher = Mock()
        self.publisher.aclose = Mock(side_effect=self._closed_publisher)
        self.publisher_closed = 0
        self.speech = Mock()
        self.error = Mock()
        self.stt: FakeStt | None = None

    async def _closed_publisher(self) -> None:
        self.publisher_closed += 1

    def stt_factory(self, settings: SttSettings, *, on_update: Callable[[str, str], None]) -> Any:
        self.stt = FakeStt(settings, on_update=on_update)
        return self.stt

    def open(self) -> AnswerCapture:
        with (
            patch("app.agent.capture.rtc.AudioStream.from_participant", return_value=self.stream),
            patch("app.agent.capture.TranscriptPublisher", return_value=self.publisher),
        ):
            return AnswerCapture(
                Mock(),
                Mock(identity="candidate"),
                SttSettings(api_key="key"),
                on_speech=self.speech,
                on_error=self.error,
                clock=self.clock,
                stt_factory=self.stt_factory,
            )


def test_answer_starts_at_the_first_frame_and_finish_waits_for_final_tokens() -> None:
    async def scenario() -> None:
        o = Opened()
        capture = o.open()
        # 마이크 구독이 늦어 1.5초 뒤에 첫 프레임이 온다
        o.clock.now = OPENED + timedelta(milliseconds=1500)
        await o.stream.frames.put(b"\x01\x00" * 160)
        await settle()
        o.clock.now = OPENED + timedelta(seconds=3)
        await o.stream.frames.put(b"\x02\x00" * 160)
        await settle()
        assert o.stt is not None
        o.stt.respond(SonioxToken("조회", 0, 280, True))

        await capture.finish()

        assert capture.started_at == OPENED + timedelta(milliseconds=1500)
        assert o.stt.finished
        assert o.stt.sent == [b"\x01\x00" * 160, b"\x02\x00" * 160]
        assert capture.content == "조회다"
        assert capture.tokens() == (SpeechToken("조회", 0, 280), SpeechToken("다", 300, 400))
        assert o.stream.closed == 1 and o.publisher_closed == 1
        voice = await capture.voice(capture.tokens())
        assert voice.trailing_off_ratio is None or voice.trailing_off_ratio >= 0

    asyncio.run(scenario())


def test_speech_is_reported_only_when_the_last_spoken_time_grows() -> None:
    async def scenario() -> None:
        o = Opened()
        capture = o.open()
        await settle()
        assert o.stt is not None
        o.stt.respond(SonioxToken("안녕", 0, 200, False))
        o.stt.respond(SonioxToken("안녕", 0, 200, False))
        o.stt.respond(SonioxToken(" ", 200, 900, False))
        o.stt.respond(SonioxToken("안녕하세요", 0, 600, False))
        assert o.speech.call_count == 2
        o.publisher.update.assert_called_with("", "안녕하세요")
        await capture.discard()

    asyncio.run(scenario())


def test_stt_failure_while_listening_is_reported_once_and_closes_the_stream() -> None:
    async def scenario() -> None:
        o = Opened()
        capture = o.open()
        await settle()
        assert o.stt is not None
        o.stt.fail.set()
        await settle()
        o.error.assert_called_once()
        o.publisher.fail.assert_called_once()
        # 더 보낼 곳이 없는 음성이 쌓이지 않게 바로 닫는다
        assert o.stream.closed == 1
        await capture.discard()
        await capture.discard()
        assert o.stream.closed == 1 and o.publisher_closed == 1

    asyncio.run(scenario())


def test_stt_failure_while_finishing_is_not_reported() -> None:
    async def scenario() -> None:
        o = Opened()
        capture = o.open()
        await settle()
        assert o.stt is not None
        o.stt.fail_on_finish = True
        await capture.finish()
        o.error.assert_not_called()
        o.publisher.fail.assert_not_called()

    asyncio.run(scenario())


def test_voice_metrics_failure_is_sent_empty() -> None:
    async def scenario() -> None:
        o = Opened()
        capture = o.open()
        await capture.discard()
        with patch("app.agent.capture.voice_metrics", side_effect=ValueError("계산 실패")):
            voice = await capture.voice((SpeechToken("조회", 0, 280),))
        assert (voice.trailing_off_ratio, voice.pitch_range_st) == (None, None)

    asyncio.run(scenario())


def test_stream_open_failure_starts_nothing() -> None:
    publisher = Mock()
    with (
        patch(
            "app.agent.capture.rtc.AudioStream.from_participant",
            side_effect=RuntimeError("FFI 오류"),
        ),
        patch("app.agent.capture.TranscriptPublisher", return_value=publisher) as made,
        pytest.raises(RuntimeError, match="FFI"),
    ):
        AnswerCapture(
            Mock(),
            Mock(identity="candidate"),
            SttSettings(api_key="key"),
            on_speech=Mock(),
            on_error=Mock(),
            clock=Clock(),
        )
    made.assert_not_called()
