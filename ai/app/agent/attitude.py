"""답변을 듣는 동안 인상 판단으로 인상 점수를 계산해 지원자 화면에 보낸다.

기준: AI 명세 6.3 interview.attitude, 6.6 인상 판단.
- 사진 판단(1초마다 1장)이 하나 올 때마다 가장 최근 사진부터 ATTITUDE_WINDOW 안의 판단으로 계산한다.
- 얼굴이 아닌 사진(face < ATTITUDE_FACE_LIMIT)은 뺀다. 결과 타임라인과 같은 기준이다.
- 사진마다 받은 점수를 평균하고, 사진들의 평균을 다시 평균한다.
- 그 평균의 ATTITUDE_LOW~ATTITUDE_HIGH를 0~100으로 펴고, 범위 밖은 0·100으로 자른 뒤
  정수로 반올림한다. 쓸 수 있는 사진이 없으면 null이다.
- 점수가 바뀔 때만 보내고, 보내는 중에 새 점수가 나오면 마지막 값만 보낸다.
  화면이 받지 못해도 면접은 계속 진행한다.
"""

import asyncio
import json
import logging
from collections.abc import Callable, Coroutine, Sequence
from datetime import timedelta
from typing import Any

from app.common.rounding import round_half_up_int
from app.interview.realtime.impression import TimedImpression

log = logging.getLogger(__name__)

ATTITUDE_METHOD = "interview.attitude"
# 가장 최근 사진부터 이 범위 안에 찍은 판단만 쓴다. 1초마다 1장이면 약 3장이다
ATTITUDE_WINDOW = timedelta(seconds=3)
# 결과 타임라인(app.interview.result.timeline.FACE_LIMIT)과 같은 얼굴 기준
ATTITUDE_FACE_LIMIT = 0.5
# 인상 점수 평균은 대부분 가운데에서만 움직여 이 범위를 0~100으로 편다
# (사용자 결정 2026-11-12, 임시 값)
ATTITUDE_LOW = 20.0
ATTITUDE_HIGH = 80.0

AttitudeSender = Callable[[str], Coroutine[Any, Any, None]]


def attitude_score(frames: Sequence[TimedImpression]) -> int | None:
    """최근 판단의 인상 점수(0~100). 쓸 수 있는 사진이 없으면 None이다."""
    if not frames:
        return None
    latest = max(frame.captured_at for frame in frames)
    means: list[float] = []
    for frame in frames:
        if latest - frame.captured_at > ATTITUDE_WINDOW:
            continue
        if frame.impression.face < ATTITUDE_FACE_LIMIT:
            continue
        scores = [score for score in frame.impression.scores.values() if score is not None]
        if scores:
            means.append(sum(scores) / len(scores))
    if not means:
        return None
    mean = sum(means) / len(means)
    stretched = (mean - ATTITUDE_LOW) * 100 / (ATTITUDE_HIGH - ATTITUDE_LOW)
    return round_half_up_int(min(max(stretched, 0.0), 100.0))


def attitude_payload(session_id: int, score: int | None) -> str:
    """interview.attitude 본문(AI 명세 6.3)."""
    message = {"type": "attitude", "sessionId": session_id, "score": score}
    return json.dumps(message, separators=(",", ":"))


class AttitudePublisher:
    """답변 하나 동안 인상 점수를 지원자 화면에 보낸다.

    대기 중인 점수는 최신 하나만 유지한다.
    """

    def __init__(self, send: AttitudeSender, session_id: int) -> None:
        self._send_message = send
        self._session_id = session_id
        self._sent: int | None = None
        self._pending: str | None = None
        self._ready = asyncio.Event()
        self._task = asyncio.create_task(self._send())

    def update(self, frames: Sequence[TimedImpression]) -> None:
        """새 판단이 왔다. 점수가 바뀌었을 때만 보낸다.

        처음부터 쓸 수 있는 사진이 없으면 보내지 않는다.
        화면은 점수를 받기 전까지 확인 중으로 표시한다.
        """
        score = attitude_score(frames)
        if score == self._sent:
            return
        self._sent = score
        self._pending = attitude_payload(self._session_id, score)
        self._ready.set()

    async def _send(self) -> None:
        while True:
            await self._ready.wait()
            self._ready.clear()
            payload = self._pending
            self._pending = None
            if payload is not None:
                await self._send_message(payload)

    async def aclose(self) -> None:
        """답변이 끝났다. 보내지 못한 점수는 버린다."""
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)
