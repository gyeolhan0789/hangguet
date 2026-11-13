"""답변 중 인상 점수 시험(AI 명세 6.3 interview.attitude)."""

import asyncio
import json
from datetime import datetime, timedelta

from app.agent.attitude import (
    ATTITUDE_WINDOW,
    AttitudePublisher,
    attitude_payload,
    attitude_score,
)
from app.common.results import KST
from app.interview.realtime.impression import Impression, TimedImpression

NOW = datetime(2026, 11, 12, 14, 0, 0, tzinfo=KST)


def frame(
    seconds_ago: float, scores: dict[str, float | None], face: float = 0.9
) -> TimedImpression:
    return TimedImpression(NOW - timedelta(seconds=seconds_ago), Impression(face, scores))


def test_no_frame_is_none() -> None:
    assert attitude_score(()) is None


def test_score_is_mean_of_frame_means() -> None:
    frames = (
        frame(0, {"stability": 80.0, "trust": 60.0}),
        frame(1, {"stability": 40.0, "trust": None, "confidence": 60.0}),
    )
    # 사진마다 70, 50 → 평균 60 → (60 - 20) / 60 × 100 = 66.7
    assert attitude_score(frames) == 67


def test_only_recent_window_from_latest_frame_is_used() -> None:
    window = ATTITUDE_WINDOW.total_seconds()
    frames = (
        frame(0, {"trust": 50.0}),
        frame(window, {"trust": 30.0}),
        frame(window + 0.5, {"trust": 0.0}),
    )
    # 50, 30 → 평균 40 → 33.3
    assert attitude_score(frames) == 33


def test_frames_without_face_or_scores_are_skipped() -> None:
    frames = (
        frame(0, {"trust": 90.0}, face=0.4),
        frame(1, {"trust": None}),
        frame(2, {"trust": 35.0}),
    )
    assert attitude_score(frames) == 25
    assert attitude_score(frames[:2]) is None


def test_score_stretches_range_to_0_100_and_clamps_outside() -> None:
    assert attitude_score((frame(0, {"trust": 20.0}),)) == 0
    assert attitude_score((frame(0, {"trust": 50.0}),)) == 50
    assert attitude_score((frame(0, {"trust": 80.0}),)) == 100
    assert attitude_score((frame(0, {"trust": 10.0}),)) == 0
    assert attitude_score((frame(0, {"trust": 95.0}),)) == 100


def test_score_rounds_half_up() -> None:
    # 21.5 → 2.5
    assert attitude_score((frame(0, {"trust": 21.5}),)) == 3


def test_payload_has_type_session_and_score() -> None:
    assert json.loads(attitude_payload(7, 72)) == {"type": "attitude", "sessionId": 7, "score": 72}
    assert json.loads(attitude_payload(7, None))["score"] is None


async def settle() -> None:
    for _ in range(3):
        await asyncio.sleep(0)


def test_publisher_sends_only_changes_and_latest_pending() -> None:
    async def run() -> None:
        sent: list[int | None] = []
        release = asyncio.Event()

        async def send(payload: str) -> None:
            sent.append(json.loads(payload)["score"])
            await release.wait()

        publisher = AttitudePublisher(send, 7)
        # 처음부터 쓸 사진이 없으면 보내지 않는다
        publisher.update((frame(0, {"trust": None}),))
        await settle()
        assert sent == []
        publisher.update((frame(0, {"trust": 56.0}),))
        await settle()
        assert sent == [60]
        # 보내는 중에 바뀐 점수는 마지막 값만 보낸다
        publisher.update((frame(0, {"trust": 59.0}),))
        publisher.update((frame(0, {"trust": 62.0}),))
        # 같은 점수는 다시 보내지 않는다
        publisher.update((frame(0, {"trust": 62.0}),))
        release.set()
        await settle()
        assert sent == [60, 70]
        # 쓸 사진이 없어지면 null을 보낸다
        publisher.update((frame(0, {"trust": 50.0}, face=0.1),))
        await settle()
        assert sent == [60, 70, None]
        await publisher.aclose()

    asyncio.run(run())


def test_closed_publisher_drops_pending_score() -> None:
    async def run() -> None:
        sent: list[str] = []

        async def send(payload: str) -> None:
            sent.append(payload)

        publisher = AttitudePublisher(send, 7)
        await publisher.aclose()
        publisher.update((frame(0, {"trust": 60.0}),))
        await settle()
        assert sent == []

    asyncio.run(run())
