"""답변 중 카메라 사진 인상 판단 시험(AI 명세 6.3·6.6)."""

import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

from app.agent.impression import (
    IMAGE_HEADER,
    JEV_MODEL,
    JEV_URL,
    MAX_FRAME_BYTES,
    ImpressionJudge,
    ImpressionRecorder,
    read_frame,
)
from app.common.results import KST
from app.interview.realtime.impression import (
    FACE_QUESTION,
    IMPRESSION_CRITERIA,
    Impression,
    TimedImpression,
)

NOW = datetime(2026, 10, 30, 14, 0, 0, tzinfo=KST)
IMPRESSION = Impression(face=0.9, scores={key: 50.0 for key in IMPRESSION_CRITERIA})


class FakeJudge:
    """판단마다 시험이 직접 끝내는 응답을 돌려준다."""

    model = JEV_MODEL

    def __init__(self) -> None:
        self.calls: list[bytes] = []
        self.pending: list[asyncio.Future[Impression | None]] = []
        self.closed = False

    async def judge(self, jpeg: bytes) -> Impression | None:
        future: asyncio.Future[Impression | None] = asyncio.get_running_loop().create_future()
        self.calls.append(jpeg)
        self.pending.append(future)
        return await future

    async def aclose(self) -> None:
        self.closed = True


async def settle() -> None:
    # 만든 작업이 판단 요청까지 진행하도록 이벤트 루프를 몇 번 돌린다
    for _ in range(3):
        await asyncio.sleep(0)


def recorder(judge: FakeJudge, **kwargs: Any) -> ImpressionRecorder:
    return ImpressionRecorder(judge, clock=lambda: NOW, **kwargs)


def test_frames_outside_answer_are_dropped() -> None:
    """답변을 듣는 중이 아니면 판단하지 않는다(AI 명세 6.6 판단 구간)."""

    async def run() -> None:
        judge = FakeJudge()
        frames = recorder(judge)
        frames.submit(b"jpeg", 0)
        await settle()
        assert judge.calls == []

    asyncio.run(run())


def test_judged_frame_has_capture_time_from_age() -> None:
    """찍은 시각은 받은 시각에서 ageMs를 뺀다(AI 명세 6.6 시각)."""

    async def run() -> None:
        judge = FakeJudge()
        frames = recorder(judge)
        frames.start()
        frames.submit(b"jpeg", 300)
        await settle()
        judge.pending[0].set_result(IMPRESSION)
        await settle()
        assert frames.stop() == (TimedImpression(NOW - timedelta(milliseconds=300), IMPRESSION),)
        assert judge.calls == [b"jpeg"]

    asyncio.run(run())


def test_frames_beyond_in_flight_limit_are_dropped() -> None:
    async def run() -> None:
        judge = FakeJudge()
        frames = recorder(judge, max_in_flight=2)
        frames.start()
        for _ in range(3):
            frames.submit(b"jpeg", 0)
        await settle()
        assert len(judge.calls) == 2
        judge.pending[0].set_result(IMPRESSION)
        await settle()
        frames.submit(b"next", 0)
        await settle()
        assert judge.calls[-1] == b"next"
        frames.stop()

    asyncio.run(run())


def test_stop_cancels_pending_and_returns_received_in_capture_order() -> None:
    """답변이 끝날 때 응답이 오지 않은 판단은 기다리지 않는다(AI 명세 6.6 요청)."""

    async def run() -> None:
        judge = FakeJudge()
        clock = iter([NOW + timedelta(seconds=2), NOW + timedelta(seconds=1), NOW])
        frames = ImpressionRecorder(judge, clock=lambda: next(clock), max_in_flight=3)
        frames.start()
        for jpeg in (b"late", b"early", b"pending"):
            frames.submit(jpeg, 0)
        await settle()
        judge.pending[0].set_result(IMPRESSION)
        judge.pending[1].set_result(IMPRESSION)
        await settle()

        result = frames.stop()
        await settle()

        assert [frame.captured_at for frame in result] == [
            NOW + timedelta(seconds=1),
            NOW + timedelta(seconds=2),
        ]
        assert judge.pending[2].cancelled()

    asyncio.run(run())


def test_failed_judgment_is_not_kept() -> None:
    async def run() -> None:
        judge = FakeJudge()
        frames = recorder(judge)
        frames.start()
        frames.submit(b"jpeg", 0)
        await settle()
        judge.pending[0].set_result(None)
        await settle()
        assert frames.stop() == ()

    asyncio.run(run())


def test_new_answer_discards_previous_answer() -> None:
    """폐기한 답변의 판단이 다음 답변에 섞이지 않는다."""

    async def run() -> None:
        judge = FakeJudge()
        frames = recorder(judge)
        frames.start()
        frames.submit(b"old", 0)
        await settle()
        judge.pending[0].set_result(IMPRESSION)
        await settle()
        frames.start()
        assert frames.judged() == ()
        frames.stop()

    asyncio.run(run())


def test_judged_keeps_listening() -> None:
    async def run() -> None:
        judge = FakeJudge()
        frames = recorder(judge)
        frames.start()
        frames.submit(b"jpeg", 0)
        await settle()
        judge.pending[0].set_result(IMPRESSION)
        await settle()
        assert len(frames.judged()) == 1
        frames.submit(b"more", 0)
        await settle()
        assert judge.calls == [b"jpeg", b"more"]
        frames.stop()

    asyncio.run(run())


def test_each_judgment_calls_listener_until_answer_ends() -> None:
    async def run() -> None:
        judge = FakeJudge()
        frames = recorder(judge)
        seen: list[int] = []
        frames.start(lambda judged: seen.append(len(judged)))
        frames.submit(b"first", 0)
        await settle()
        judge.pending[0].set_result(IMPRESSION)
        await settle()
        frames.submit(b"second", 0)
        await settle()
        judge.pending[1].set_result(IMPRESSION)
        await settle()
        assert seen == [1, 2]
        frames.stop()
        # 다음 답변을 리스너 없이 시작하면 이전 리스너를 부르지 않는다
        frames.start()
        frames.submit(b"next", 0)
        await settle()
        judge.pending[2].set_result(IMPRESSION)
        await settle()
        assert seen == [1, 2]
        frames.stop()

    asyncio.run(run())


def test_received_stream_is_read_then_judged() -> None:
    async def run() -> None:
        judge = FakeJudge()
        frames = recorder(judge)
        frames.start()

        async def read() -> tuple[bytes, int] | None:
            return b"jpeg", 0

        frames.receive(read)
        await settle()
        assert judge.calls == [b"jpeg"]
        await frames.aclose()
        assert judge.closed

    asyncio.run(run())


class FakeStream:
    def __init__(
        self, chunks: list[bytes], attributes: dict[str, str] | None, error: bool = False
    ) -> None:
        self.info = MagicMock(attributes=attributes)
        self._chunks = chunks
        self._error = error
        self.closed = False

    async def _iterate(self) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            yield chunk
        if self._error:
            raise ConnectionError("aborted")

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self._iterate()

    def close(self) -> None:
        self.closed = True


def test_frame_is_body_and_age() -> None:
    stream = FakeStream([b"ab", b"cd"], {"ageMs": "120"})

    assert asyncio.run(read_frame(stream)) == (b"abcd", 120)
    assert stream.closed


@pytest.mark.parametrize("attributes", [None, {}, {"ageMs": ""}, {"ageMs": "-5"}, {"ageMs": "1.5"}])
def test_frame_without_valid_age_is_dropped(attributes: dict[str, str] | None) -> None:
    stream = FakeStream([b"jpeg"], attributes)

    assert asyncio.run(read_frame(stream)) is None
    assert stream.closed


def test_oversized_frame_is_dropped() -> None:
    stream = FakeStream([b"x" * (MAX_FRAME_BYTES + 1)], {"ageMs": "0"})

    assert asyncio.run(read_frame(stream)) is None
    assert stream.closed


@pytest.mark.parametrize(("chunks", "error"), [([], False), ([b"jp"], True)])
def test_empty_or_aborted_frame_is_dropped(chunks: list[bytes], error: bool) -> None:
    stream = FakeStream(chunks, {"ageMs": "0"}, error=error)

    assert asyncio.run(read_frame(stream)) is None
    assert stream.closed


def body() -> dict[str, Any]:
    answers: dict[str, Any] = {FACE_QUESTION: {"type": "noul", "noul": 0.9}}
    for key in IMPRESSION_CRITERIA:
        answers[key] = {"type": "score", "score": 2.0, "confidence": 0.9}
    return {"model": JEV_MODEL, "answers": answers}


def http_session(status: int = 200, payload: object = None) -> MagicMock:
    response = MagicMock(status=status)
    response.json = AsyncMock(return_value=body() if payload is None else payload)
    response.__aenter__ = AsyncMock(return_value=response)
    response.__aexit__ = AsyncMock(return_value=False)
    session = MagicMock()
    session.post = MagicMock(return_value=response)
    session.close = AsyncMock()
    return session


def judge_with(session: MagicMock, **kwargs: Any) -> Impression | None:
    async def run() -> Impression | None:
        judge = ImpressionJudge("secret", **kwargs)
        try:
            return await judge.judge(b"jpeg")
        finally:
            await judge.aclose()

    with patch("app.agent.impression.aiohttp.ClientSession", return_value=session):
        return asyncio.run(run())


def test_judge_sends_image_asset_with_danger_zone_header() -> None:
    """이미지 입력은 assets와 TypeSafe-Danger-Zone-Images 헤더로 보낸다(Jev 문서 images)."""
    session = http_session()

    impression = judge_with(session)

    assert impression == IMPRESSION
    url = session.post.call_args.args[0]
    kwargs = session.post.call_args.kwargs
    assert url == JEV_URL
    assert kwargs["headers"] == {"Authorization": "Bearer secret", IMAGE_HEADER: "true"}
    assert kwargs["json"]["model"] == JEV_MODEL
    asset = next(iter(kwargs["json"]["assets"].values()))
    assert asset == {"type": "image", "format": "jpeg", "data_base64": "anBlZw=="}
    session.close.assert_awaited_once()


@pytest.mark.parametrize(
    "session",
    [http_session(status=500), http_session(payload=[]), http_session(payload={"answers": {}})],
)
def test_failed_judgment_is_none(session: MagicMock, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)

    assert judge_with(session) is None
    assert "Jev 인상 판단 실패" in caplog.text


def test_connection_error_is_none() -> None:
    session = http_session()
    session.post.side_effect = aiohttp.ClientConnectionError()

    assert judge_with(session) is None


def test_slow_judgment_is_none(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    session = http_session()

    async def slow(*_args: Any) -> None:
        await asyncio.sleep(1)

    session.post.return_value.__aenter__ = slow

    assert judge_with(session, timeout_seconds=0.01) is None
    assert "시간 초과" in caplog.text
