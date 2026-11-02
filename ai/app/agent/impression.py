"""화면이 보낸 카메라 사진을 답변을 듣는 동안 Jev로 판단해 인상 점수를 모은다.

기준: AI 명세 6.6 인상 판단, 6.3 interview.frame, Jev 문서 images.
- 사진은 바이트 스트림 interview.frame으로 1초마다 온다.
  답변을 듣는 동안(start ~ stop)이 아니면 판단하지 않고 버린다.
- 찍은 시각은 받은 시각에서 화면이 보낸 ageMs를 뺀다.
  브라우저 시계는 서버와 어긋날 수 있어 쓰지 않는다.
- 동시 요청은 MAX_IN_FLIGHT개다. 판단 중인 요청이 가득 차면 새 사진은 버린다.
  1초마다 오는 사진을 쌓아 두면 응답이 늦을 때 판단이 점점 밀리기 때문이다.
- 답변이 끝나면 응답이 오지 않은 판단은 기다리지 않고 취소한다(AI 명세 6.6).
- 리액션 판단(app.agent.jev)과 연결을 나누지 않는다.
  리액션은 0.8초 상한이라 인상 판단 요청과 연결을 다투면 늦어지기 때문이다.
- 사진은 로그에 남기지 않는다.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any, Protocol

import aiohttp

from app.agent.metrics import JEV_IMAGE_REQUESTS
from app.common.results import KST
from app.common.timing import elapsed_ms
from app.common.versions import REGISTRY, VersionKind
from app.interview.realtime.impression import (
    IMPRESSION_PROMPT_VERSION,
    Impression,
    InvalidImpressionError,
    TimedImpression,
    impression_assets,
    impression_from,
    impression_questions,
    impression_state,
)

log = logging.getLogger(__name__)
JEV_URL = "https://api.typesafe.ai/v1/systemone"
# AI 명세 6.6: 리액션 판단과 같은 모델 버전으로 고정한다
JEV_MODEL = "jev-1.14.0"
# Jev 문서 images: 이미지 입력은 이 헤더를 켜야 받는다
IMAGE_HEADER = "TypeSafe-Danger-Zone-Images"
# AI 명세 6.6(임시 값): 응답을 기다리는 상한(초)
IMPRESSION_TIMEOUT_SECONDS = 5.0
# AI 명세 6.6(임시 값): 동시에 판단하는 사진 수
MAX_IN_FLIGHT = 2
# AI 명세 6.3: 사진 하나의 상한(바이트). 640×480 JPEG는 이보다 훨씬 작다
MAX_FRAME_BYTES = 1_000_000
FRAME_TOPIC = "interview.frame"


class JevImageError(RuntimeError):
    """Jev에서 인상 판단을 수신하지 못했다."""


class FrameJudge(Protocol):
    @property
    def model(self) -> str: ...

    async def judge(self, jpeg: bytes) -> Impression | None: ...

    async def aclose(self) -> None: ...


class ImpressionJudge:
    def __init__(
        self,
        api_key: str,
        *,
        timeout_seconds: float = IMPRESSION_TIMEOUT_SECONDS,
        timer: Callable[[], float] = time.monotonic,
    ) -> None:
        self._api_key = api_key
        self._model = REGISTRY.require(VersionKind.MODEL, JEV_MODEL)
        REGISTRY.require(VersionKind.PROMPT, IMPRESSION_PROMPT_VERSION)
        self._timeout_seconds = timeout_seconds
        self._timer = timer
        self._session: aiohttp.ClientSession | None = None

    @property
    def model(self) -> str:
        return self._model

    async def judge(self, jpeg: bytes) -> Impression | None:
        """판단하지 못하면 None이다(AI 명세 6.5)."""
        started = self._timer()
        try:
            async with asyncio.timeout(self._timeout_seconds):
                answers = await self._ask(base64.b64encode(jpeg).decode("ascii"))
            impression = impression_from(answers)
        except TimeoutError:
            JEV_IMAGE_REQUESTS.labels(result="timeout").inc()
            log.warning("Jev 인상 판단 시간 초과 ms=%d", elapsed_ms(started, self._timer()))
        except (JevImageError, InvalidImpressionError) as e:
            JEV_IMAGE_REQUESTS.labels(result="error").inc()
            log.warning("Jev 인상 판단 실패: %s ms=%d", e, elapsed_ms(started, self._timer()))
        else:
            JEV_IMAGE_REQUESTS.labels(result="ok").inc()
            return impression
        return None

    async def aclose(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    async def _ask(self, jpeg_base64: str) -> object:
        if self._session is None:
            self._session = aiohttp.ClientSession()
        body: dict[str, Any] = {
            "model": self._model,
            "assets": impression_assets(jpeg_base64),
            "state": impression_state(),
            "questions": impression_questions(),
        }
        try:
            async with self._session.post(
                JEV_URL,
                headers={"Authorization": f"Bearer {self._api_key}", IMAGE_HEADER: "true"},
                json=body,
            ) as response:
                if response.status != 200:
                    raise JevImageError(f"status={response.status}")
                result = await response.json()
        except (aiohttp.ClientError, ValueError) as e:
            raise JevImageError(type(e).__name__) from e
        if not isinstance(result, dict):
            raise JevImageError("응답이 객체가 아니다")
        return result.get("answers")


class FrameStream(Protocol):
    """LiveKit 바이트 스트림 수신기(rtc.ByteStreamReader)에서 쓰는 부분이다."""

    @property
    def info(self) -> Any: ...

    def __aiter__(self) -> AsyncIterator[bytes]: ...

    def close(self) -> None: ...


async def read_frame(stream: FrameStream) -> tuple[bytes, int] | None:
    """사진 본문과 ageMs다. 형식이 틀리거나 상한을 넘거나 끊긴 스트림이면 None이다(AI 명세 6.3)."""
    try:
        age = (stream.info.attributes or {}).get("ageMs", "")
        if not age.isdigit():
            return None
        jpeg = bytearray()
        async for chunk in stream:
            jpeg.extend(chunk)
            if len(jpeg) > MAX_FRAME_BYTES:
                return None
        return (bytes(jpeg), int(age)) if jpeg else None
    except ConnectionError:
        # 보낸 쪽이 중단했거나 면접방이 끊겼다(rtc.StreamError)
        return None
    finally:
        # 끝까지 읽지 않은 스트림은 닫아야 수신 대기열이 남지 않는다
        stream.close()


def _now() -> datetime:
    return datetime.now(KST)


class ImpressionRecorder:
    """면접 하나에서 답변마다 사진을 판단해 모은다. 답변은 한 번에 하나만 듣는다."""

    def __init__(
        self,
        judge: FrameJudge,
        *,
        max_in_flight: int = MAX_IN_FLIGHT,
        clock: Callable[[], datetime] = _now,
    ) -> None:
        self._judge = judge
        self._max_in_flight = max_in_flight
        self._clock = clock
        self._recording = False
        self._frames: list[TimedImpression] = []
        self._judging: set[asyncio.Task[None]] = set()
        self._reading: set[asyncio.Task[None]] = set()

    @property
    def model(self) -> str:
        """판단에 쓴 Jev 모델(answer.completed speech.impressions.modelVersion)."""
        return self._judge.model

    def start(self) -> None:
        """답변을 듣기 시작한다. 이전 답변에서 남은 판단은 버린다."""
        self._discard()
        self._recording = True

    def stop(self) -> tuple[TimedImpression, ...]:
        """답변을 끝낸다. 응답이 오지 않은 판단은 취소하고 받은 판단을 찍은 시각 순으로 반환한다."""
        frames = tuple(sorted(self._frames, key=lambda frame: frame.captured_at))
        self._discard()
        return frames

    def judged(self) -> tuple[TimedImpression, ...]:
        """지금까지 받은 판단이다. 답변은 계속 듣는다."""
        return tuple(sorted(self._frames, key=lambda frame: frame.captured_at))

    def submit(self, jpeg: bytes, age_ms: int) -> None:
        """사진 하나를 판단한다. 답변을 듣는 중이 아니거나 판단 중인 요청이 가득 차면 버린다."""
        if not self._recording or len(self._judging) >= self._max_in_flight:
            return
        captured_at = self._clock() - timedelta(milliseconds=max(age_ms, 0))
        task = asyncio.create_task(self._judge_frame(jpeg, captured_at))
        self._judging.add(task)
        task.add_done_callback(self._judging.discard)

    def receive(self, read: Callable[[], Awaitable[tuple[bytes, int] | None]]) -> None:
        """바이트 스트림 하나를 끝까지 읽은 뒤 판단한다. 읽기는 처리 함수 밖에서 실행한다."""
        task = asyncio.create_task(self._receive(read))
        self._reading.add(task)
        task.add_done_callback(self._reading.discard)

    async def aclose(self) -> None:
        self._discard()
        reading = list(self._reading)
        for task in reading:
            task.cancel()
        await asyncio.gather(*reading, return_exceptions=True)
        await self._judge.aclose()

    async def _receive(self, read: Callable[[], Awaitable[tuple[bytes, int] | None]]) -> None:
        frame = await read()
        if frame is not None:
            self.submit(*frame)

    async def _judge_frame(self, jpeg: bytes, captured_at: datetime) -> None:
        impression = await self._judge.judge(jpeg)
        # 취소되지 않고 끝났으면 같은 답변 안이다(stop·start가 판단 중인 요청을 취소한다)
        if impression is not None:
            self._frames.append(TimedImpression(captured_at, impression))

    def _discard(self) -> None:
        self._recording = False
        self._frames = []
        for task in list(self._judging):
            task.cancel()
        self._judging.clear()
