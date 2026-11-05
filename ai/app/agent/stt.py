"""Soniox에 음성을 전송하고, 수신한 응답을 전사 상태(Transcript)에 반영한다.

확정 토큰 고르기·시각 보정은 app.interview.realtime.transcript가 담당하고,
이 모듈은 Soniox 연결과 화면 갱신만 맡는다.
같은 응답을 두 곳에서 따로 해석하면 한쪽만 변경됐을 때 화면 글과 답변 글이 어긋나기 때문이다.

연결을 계속 사용할 수 없으면 다시 연결한다(AI 명세 6.5).
- 연결하지 못하거나, 연결이 끊기거나, 음성을 전송했는데 응답이 없으면 다시 연결한다.
- 다시 연결하는 동안 읽은 음성은 전송하지 않고 폐기한다.
  모아 두었다가 이어 전송하면 지원자가 처음부터 다시 말할 때 같은 내용이 두 번 인식되기 때문이다.
- 음성 위치는 폐기한 음성까지 포함해 계산하므로 새 연결의 토큰 시각도 답변 시작 기준으로 이어진다.
- 인식하지 못한 구간은 gaps로 제공한다(answer.completed sttGaps).
- 음성을 다 전송한 뒤에는 다시 연결하지 않는다. 더 전송할 음성이 없기 때문이다.

답변이 끝나면 음성을 읽고 전송한 양, 응답 수, 끊긴 원인을 요약 로그 한 줄로 남긴다.
인식 결과가 비었을 때 음성이 오지 않았는지, Soniox가 응답하지 않았는지,
응답은 왔지만 글자가 없었는지를 로그만으로 구분하기 위함이다.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterable, Callable, Mapping
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import aiohttp

from app.agent.metrics import SONIOX_AUDIO_SECONDS
from app.common.answer import SttGap
from app.interview.realtime.sentence import has_endpoint
from app.interview.realtime.transcript import Transcript, soniox_tokens

log = logging.getLogger(__name__)
SONIOX_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
SAMPLE_RATE = 16000
# 지원자 음성을 이 길이씩 받아 보낸다. 10ms씩이면 조각마다 SDK와 파이썬을 오가는 비용으로
# CPU를 더 쓴다(loadtest/report/agent-audio-2026-11-04.md).
# Soniox 예제도 약 128ms(4096바이트)씩 보낸다
CHUNK_MS = 100
# audio_format pcm_s16le: 표본 하나가 2바이트(16비트)다
BYTES_PER_SAMPLE = 2
_BYTES_PER_MS = SAMPLE_RATE * BYTES_PER_SAMPLE / 1000
# AI 명세 6.5: 다시 연결 간격(초)과 횟수. 첫 번째는 바로, 이후 2초씩 최대 3회다.
# LiveKit Agents의 STT 연결 기본값(APIConnectOptions)과 같다
RECONNECT_DELAYS = (0.1, 2.0, 2.0)
# AI 명세 6.5: 연결 제한 시간(초). LiveKit Agents 기본값과 같다
CONNECT_TIMEOUT_SECONDS = 10.0
# AI 명세 6.5: 음성을 전송했는데 이 시간 동안 응답이 없으면
# 연결이 멈춘 것으로 간주한다(초, 임시 값).
# Soniox는 무음 중에도 약 1초마다 응답하며, 5개 조건 20회 실측한 최대 응답 간격은 1.32초였다
NO_RESPONSE_SECONDS = 5.0
# 음성을 다 전송한 뒤 종료 응답을 기다리는 시간(초)
FINISH_TIMEOUT_SECONDS = 15.0


class SttError(RuntimeError):
    """음성 인식을 계속할 수 없다."""


class _SonioxResponseError(SttError):
    """Soniox가 오류 응답을 전송했다.

    오류 코드로 원인을 구분한다.
    """

    def __init__(self, code: object) -> None:
        super().__init__(f"Soniox STT 오류 (code={code})")
        self.code = code


class _ClosedError(SttError):
    """Soniox가 종료 응답 없이 연결을 닫았다."""


class LostReason(StrEnum):
    """연결을 계속 사용할 수 없게 된 원인이다(재연결 로그의 reason, 요약 로그의 failures)."""

    CONNECT_FAILED = "connect_failed"
    NO_RESPONSE = "no_response"
    SONIOX_ERROR = "soniox_error"
    CLOSED = "closed"
    RECEIVE_FAILED = "receive_failed"
    FINISHED_EARLY = "finished_early"
    SEND_FAILED = "send_failed"
    KEEPALIVE_FAILED = "keepalive_failed"


class SttResult(StrEnum):
    """답변 하나의 음성 인식이 끝난 방식이다(요약 로그의 result)."""

    COMPLETED = "completed"
    RECONNECT_FAILED = "reconnect_failed"
    AUDIO_FAILED = "audio_failed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SttState(StrEnum):
    """다시 연결 진행 상태(answer.state sttReconnecting, 답변 끝 판단의 재연결 단계)."""

    RECONNECTING = "reconnecting"
    RECONNECTED = "reconnected"


class _ConnectionLostError(Exception):
    """연결을 계속 사용할 수 없다. 다시 연결하면 이어서 들을 수 있다."""

    def __init__(self, reason: LostReason, detail: str = "") -> None:
        super().__init__(f"{reason}({detail})" if detail else str(reason))
        self.reason = reason
        self.detail = detail


class _AudioFeed:
    """지원자 음성을 끝까지 읽어 지금 연결로 전달하고, 읽은 위치(밀리초)를 기록한다.

    첫 연결 전에 읽은 음성은 첫 연결로 전송하고, 다시 연결하는 동안 읽은 음성은 폐기한다.
    음성이 끝나면 연결에 None을 전달한다.
    """

    def __init__(self, audio: AsyncIterable[bytes]) -> None:
        self._audio = audio
        self.position_ms = 0.0
        # 첫 음성 조각을 읽은 시각(이벤트 루프 시각). 읽지 못했으면 None이다
        self.first_chunk_at: float | None = None
        self.ended = asyncio.Event()
        self._sink: asyncio.Queue[bytes | None] | None = asyncio.Queue()

    def first(self) -> asyncio.Queue[bytes | None]:
        """첫 연결이 전송할 음성이다. 연결을 여는 동안 읽은 음성도 담겨 있다."""
        assert self._sink is not None
        return self._sink

    def attach(self) -> asyncio.Queue[bytes | None]:
        """다시 연결한 연결이 전송할 음성이다. 지금 위치부터 담는다."""
        sink: asyncio.Queue[bytes | None] = asyncio.Queue()
        if self.ended.is_set():
            sink.put_nowait(None)
        self._sink = sink
        return sink

    def detach(self) -> None:
        """연결이 없는 동안 읽은 음성은 폐기한다."""
        self._sink = None

    async def run(self) -> None:
        async for chunk in self._audio:
            if self.first_chunk_at is None:
                self.first_chunk_at = asyncio.get_running_loop().time()
            self.position_ms += len(chunk) / _BYTES_PER_MS
            if self._sink is not None:
                self._sink.put_nowait(chunk)
        self.ended.set()
        if self._sink is not None:
            self._sink.put_nowait(None)


@dataclass(frozen=True)
class SttSettings:
    api_key: str = field(repr=False)
    model: str = "stt-rt-v5"

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> SttSettings:
        key = env.get("SONIOX_API_KEY", "").strip()
        if not key:
            raise SttError("SONIOX_API_KEY가 필요합니다")
        return cls(api_key=key, model=env.get("SONIOX_STT_MODEL") or "stt-rt-v5")


class SonioxSTT:
    def __init__(
        self,
        settings: SttSettings,
        *,
        on_update: Callable[[str, str], None] | None = None,
        on_state: Callable[[SttState], None] | None = None,
        reconnect_delays: tuple[float, ...] = RECONNECT_DELAYS,
        no_response_seconds: float = NO_RESPONSE_SECONDS,
    ) -> None:
        self.settings = settings
        # 답변 하나의 전사 상태다. 첫 연결은 음성 시작(0ms)부터 전송한다.
        # 다시 연결하면 그 연결로 처음 전송하는 음성의 위치를 offset으로 다시 시작한다
        self.transcript = Transcript()
        self.transcript.begin_connection(0)
        self._on_update = on_update
        self._on_state = on_state
        self._reconnect_delays = reconnect_delays
        self._no_response_seconds = no_response_seconds
        self._gaps: list[SttGap] = []
        # 연결이 끊긴 동안이면 끊긴 연결에서 마지막으로 응답을 수신한 음성 위치, 아니면 None이다
        self._outage_start_ms: float | None = None
        self._last_response_ms = 0.0
        self._last_response_at = 0.0
        # 마지막 응답 뒤 처음 음성을 전송한 시각. 응답을 기다리는 음성이 없으면 None이다
        self._unanswered_since: float | None = None
        # 다시 연결한 연결로 음성 전송을 다시 시작한 위치.
        # 연결만 되고 응답 없이 끊기는 경우를 성공으로 간주하지 않도록,
        # 첫 응답을 수신해야 다시 연결된 것으로 간주한다
        self._resumed_ms: float | None = None
        # 응답을 수신하지 못한 채 다시 연결한 횟수.
        # 연결만 되고 응답 없이 바로 끊기는 경우에도 횟수 제한이 걸리도록 응답을 수신해야 초기화한다
        self._attempts = 0
        # 요약 로그용 집계다.
        # 다시 연결 횟수는 응답을 수신해도 초기화하지 않는다
        self._started_at = 0.0
        self._sent_ms = 0.0
        self._responses = 0
        self._first_response_at: float | None = None
        self._reconnects = 0
        self._failures: list[LostReason] = []
        self._gave_up = False
        # 마지막 응답에 끝 감지(<end>)가 있었으면 그 응답의 total_audio_proc_ms, 없으면 None이다.
        # on_update에서 문장 끝을 판단할 수 있도록 on_update를 호출하기 전에 갱신한다
        self.endpoint_proc_ms: float | None = None

    @property
    def text(self) -> str:
        """확정 글."""
        return self.transcript.confirmed_text

    @property
    def interim_text(self) -> str:
        """마지막 응답의 미확정 글."""
        return self.transcript.interim_text

    @property
    def gaps(self) -> tuple[SttGap, ...]:
        """인식하지 못한 구간(답변 시작 기준 밀리초, 시각 순)."""
        return tuple(self._gaps)

    def accept_response(self, response: dict[str, Any]) -> bool:
        """중간 결과는 교체하고 확정 토큰만 누적한다. 종료 응답이면 True."""
        if response.get("error_code") or response.get("error_message"):
            # 공급자 메시지에는 입력값이 포함될 수 있어 원문을 로그에 남기지 않는다.
            raise _SonioxResponseError(response.get("error_code", "unknown"))
        before = self.transcript.final_count
        tokens = soniox_tokens(response)
        self.transcript.apply(tokens)
        proc_ms = response.get("total_audio_proc_ms")
        self.endpoint_proc_ms = (
            float(proc_ms)
            if has_endpoint(tokens)
            and isinstance(proc_ms, int | float)
            and not isinstance(proc_ms, bool)
            else None
        )
        confirmed = self.transcript.final_count - before
        if self._on_update is not None:
            self._on_update(self.text, self.interim_text)
        if confirmed:
            log.info("STT 확정 토큰 수신", extra={"token_count": confirmed})
        return response.get("finished") is True

    async def run(self, audio: AsyncIterable[bytes]) -> None:
        """16kHz·모노·PCM s16le 스트림을 전송하고 종료 응답까지 수신한다.

        연결을 계속 사용할 수 없으면 다시 연결하고, 다시 연결하지 못하면 SttError를 발생시킨다.
        음성 공급이 실패하면 그 오류를 그대로 전파한다.
        """
        self._started_at = asyncio.get_running_loop().time()
        # 첫 연결에 실패해도 마지막 응답 뒤 경과 시간이 답변 시작 기준으로 기록되게 한다
        self._last_response_at = self._started_at
        feed = _AudioFeed(audio)
        pump = asyncio.create_task(feed.run())
        result = SttResult.COMPLETED
        error: BaseException | None = None
        try:
            await self._listen(feed, pump)
        except asyncio.CancelledError:
            result = SttResult.CANCELLED
            raise
        except Exception as e:
            error = e
            result = self._failed_result(pump)
            # 종료 응답을 수신하지 못하고 끝나도 이미 인식된 글은 폐기하지 않는다(AI 명세 6.5)
            self._keep_interim()
            raise
        finally:
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
            self._log_summary(feed, result, error)

    def _failed_result(self, pump: asyncio.Task[None]) -> SttResult:
        if self._gave_up:
            return SttResult.RECONNECT_FAILED
        if pump.done() and not pump.cancelled() and pump.exception() is not None:
            return SttResult.AUDIO_FAILED
        return SttResult.FAILED

    def _log_summary(
        self, feed: _AudioFeed, result: SttResult, error: BaseException | None
    ) -> None:
        def since_start(at: float | None) -> int | None:
            return None if at is None else round((at - self._started_at) * 1000)

        fields: dict[str, object] = {
            "result": str(result),
            "audio_ms": round(feed.position_ms),
            "sent_ms": round(self._sent_ms),
            "responses": self._responses,
            "final_tokens": self.transcript.final_count,
            "first_audio_ms": since_start(feed.first_chunk_at),
            "first_response_ms": since_start(self._first_response_at),
            "reconnects": self._reconnects,
            "gap_ms": sum(gap.end_ms - gap.start_ms for gap in self._gaps),
            "failures": [str(reason) for reason in self._failures],
        }
        if error is not None:
            fields["error"] = type(error).__name__
        # 지원자가 나가 듣기를 취소한 것은 인식 실패가 아니다
        normal = result in (SttResult.COMPLETED, SttResult.CANCELLED)
        log.log(
            logging.INFO if normal else logging.WARNING,
            "Soniox STT 답변 종료: %s",
            result,
            extra=fields,
        )

    def _keep_interim(self) -> None:
        # Soniox는 말한 뒤 몇 초가 지나야 확정하므로,
        # 끊긴 연결의 미확정 글을 폐기하면 끊기기 직전에 말한 내용이 답변에서 누락된다
        if not self.transcript.has_interim:
            return
        self.transcript.keep_interim()
        if self._on_update is not None:
            self._on_update(self.text, self.interim_text)

    async def _listen(self, feed: _AudioFeed, pump: asyncio.Task[None]) -> None:
        sink = feed.first()
        offset_ms = 0.0
        while True:
            connection = asyncio.create_task(self._connection(feed, sink, offset_ms))
            await asyncio.wait((connection, pump), return_when=asyncio.FIRST_COMPLETED)
            if pump.done() and pump.exception() is not None:
                connection.cancel()
                await asyncio.gather(connection, return_exceptions=True)
                pump.result()
            try:
                await connection
                return
            except _ConnectionLostError as lost:
                self._failures.append(lost.reason)
                feed.detach()
                self._keep_interim()
                # 응답을 수신하기 전에 다시 끊겼으면 같은 끊김이 이어지는 것이다
                self._resumed_ms = None
                if self._outage_start_ms is None:
                    self._outage_start_ms = self._last_response_ms
                    # 답변이 이미 끝났으면 다시 연결하지 않으므로 통지하지 않는다
                    if not feed.ended.is_set():
                        self._notify(SttState.RECONNECTING)
                if self._attempts >= len(self._reconnect_delays):
                    self._close_gap(feed.position_ms)
                    self._gave_up = True
                    raise SttError("Soniox STT에 다시 연결하지 못했습니다") from lost
                delay = self._reconnect_delays[self._attempts]
                self._attempts += 1
                self._reconnects += 1
                log.warning(
                    "Soniox STT 다시 연결 %d/%d: %s, 마지막 응답 뒤 %.1f초",
                    self._attempts,
                    len(self._reconnect_delays),
                    lost,
                    asyncio.get_running_loop().time() - self._last_response_at,
                    extra={"reason": str(lost.reason), "detail": lost.detail},
                )
                if await self._ended_while_waiting(delay, feed, pump):
                    # 다시 연결하기 전에 답변이 끝났으면 더 전송할 음성이 없다
                    self._close_gap(feed.position_ms)
                    return
                sink = feed.attach()
                offset_ms = feed.position_ms

    async def _ended_while_waiting(
        self, delay: float, feed: _AudioFeed, pump: asyncio.Task[None]
    ) -> bool:
        ended = asyncio.create_task(feed.ended.wait())
        try:
            await asyncio.wait((ended, pump), timeout=delay, return_when=asyncio.FIRST_COMPLETED)
        finally:
            ended.cancel()
            await asyncio.gather(ended, return_exceptions=True)
        if pump.done() and pump.exception() is not None:
            pump.result()
        return feed.ended.is_set()

    async def _connection(
        self, feed: _AudioFeed, sink: asyncio.Queue[bytes | None], offset_ms: float
    ) -> None:
        """연결 하나로 음성을 전송하고 종료 응답을 수신한다.

        음성을 다 전송하기 전에 연결을 사용할 수 없게 되면 _ConnectionLostError를 발생시킨다.
        음성을 다 전송한 뒤의 실패는 원래 오류로 전파한다.
        """
        loop = asyncio.get_running_loop()
        async with AsyncExitStack() as stack:
            try:
                async with asyncio.timeout(CONNECT_TIMEOUT_SECONDS):
                    session = await stack.enter_async_context(
                        aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
                    )
                    ws = await stack.enter_async_context(
                        session.ws_connect(
                            SONIOX_URL,
                            headers={"Authorization": f"Bearer {self.settings.api_key}"},
                            heartbeat=20,
                            timeout=aiohttp.ClientWSTimeout(ws_close=5),
                        )
                    )
                    await ws.send_json(
                        {
                            "model": self.settings.model,
                            "audio_format": "pcm_s16le",
                            "sample_rate": SAMPLE_RATE,
                            "num_channels": 1,
                            "language_hints": ["ko"],
                            "enable_endpoint_detection": True,
                        }
                    )
            except (aiohttp.ClientError, OSError, TimeoutError) as e:
                raise _ConnectionLostError(LostReason.CONNECT_FAILED, type(e).__name__) from e
            log.info("Soniox STT 연결 완료")
            self._last_response_at = loop.time()
            self._last_response_ms = offset_ms
            self._unanswered_since = None
            if self._outage_start_ms is not None:
                # 새 연결의 Soniox 시각은 0부터 시작하므로,
                # 이 연결로 처음 전송하는 음성 위치를 더한다
                self.transcript.begin_connection(offset_ms)
                self._resumed_ms = offset_ms
            ended = asyncio.Event()
            tasks = [
                asyncio.create_task(self._send(ws, sink, ended)),
                asyncio.create_task(self._receive(ws, feed)),
                asyncio.create_task(self._keepalive(ws, ended)),
                asyncio.create_task(self._watch(ended)),
            ]
            sender, receiver, keepalive, _ = tasks
            roles = {
                sender: LostReason.SEND_FAILED,
                receiver: LostReason.RECEIVE_FAILED,
                keepalive: LostReason.KEEPALIVE_FAILED,
            }
            try:
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    failure = task.exception()
                    if failure is not None:
                        raise _lost(roles.get(task), failure, ended)
                if not ended.is_set():
                    if receiver in done:
                        raise _ConnectionLostError(LostReason.FINISHED_EARLY)
                    if keepalive in done:
                        raise _ConnectionLostError(LostReason.KEEPALIVE_FAILED)
                await asyncio.wait({sender})
                failure = sender.exception()
                if failure is not None:
                    raise _lost(LostReason.SEND_FAILED, failure, ended)
                await asyncio.wait_for(receiver, timeout=FINISH_TIMEOUT_SECONDS)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)

    def _reconnected(self, resumed_ms: float) -> None:
        self._resumed_ms = None
        gap = self._close_gap(resumed_ms)
        log.info("Soniox STT 다시 연결 완료, 인식하지 못한 구간 %dms", gap.end_ms - gap.start_ms)
        self._notify(SttState.RECONNECTED)

    def _close_gap(self, end_ms: float) -> SttGap:
        assert self._outage_start_ms is not None
        start = round(self._outage_start_ms)
        gap = SttGap(start, max(start, round(end_ms)))
        self._gaps.append(gap)
        self._outage_start_ms = None
        return gap

    def _notify(self, state: SttState) -> None:
        if self._on_state is not None:
            self._on_state(state)

    async def _send(
        self,
        ws: aiohttp.ClientWebSocketResponse,
        sink: asyncio.Queue[bytes | None],
        ended: asyncio.Event,
    ) -> None:
        loop = asyncio.get_running_loop()
        while (chunk := await sink.get()) is not None:
            await asyncio.wait_for(ws.send_bytes(chunk), timeout=10)
            self._sent_ms += len(chunk) / _BYTES_PER_MS
            if self._unanswered_since is None:
                self._unanswered_since = loop.time()
            # Soniox는 전송한 음성 길이로 과금하므로 보낸 PCM 길이를 초로 환산해 기록한다
            SONIOX_AUDIO_SECONDS.inc(len(chunk) / (SAMPLE_RATE * BYTES_PER_SAMPLE))
        ended.set()
        await asyncio.wait_for(ws.send_str(""), timeout=10)

    async def _receive(self, ws: aiohttp.ClientWebSocketResponse, feed: _AudioFeed) -> None:
        loop = asyncio.get_running_loop()
        async for message in ws:
            if message.type == aiohttp.WSMsgType.TEXT:
                self._responses += 1
                if self._first_response_at is None:
                    self._first_response_at = loop.time()
                self._last_response_at = loop.time()
                self._last_response_ms = feed.position_ms
                self._unanswered_since = None
                self._attempts = 0
                if self._resumed_ms is not None:
                    self._reconnected(self._resumed_ms)
                if self.accept_response(message.json()):
                    return
            elif message.type == aiohttp.WSMsgType.ERROR:
                raise SttError("Soniox STT WebSocket 수신 오류")
        raise _ClosedError("Soniox STT가 종료 응답 없이 연결을 닫았습니다")

    async def _keepalive(self, ws: aiohttp.ClientWebSocketResponse, ended: asyncio.Event) -> None:
        while not ended.is_set():
            try:
                await asyncio.wait_for(ended.wait(), timeout=5)
            except TimeoutError:
                await asyncio.wait_for(ws.send_json({"type": "keepalive"}), timeout=10)

    async def _watch(self, ended: asyncio.Event) -> None:
        """음성을 전송했는데 응답이 없으면 _ConnectionLostError를 발생시킨다.

        음성이 오지 않는 동안(네트워크 지연 등)은 응답도 오지 않으므로,
        응답 없음으로 간주하지 않는다.
        """
        loop = asyncio.get_running_loop()
        interval = min(0.5, self._no_response_seconds / 4)
        while not ended.is_set():
            since = self._unanswered_since
            if since is not None and loop.time() - since >= self._no_response_seconds:
                raise _ConnectionLostError(LostReason.NO_RESPONSE)
            await asyncio.sleep(interval)


def _lost(role: LostReason | None, error: BaseException, ended: asyncio.Event) -> BaseException:
    """연결 작업의 오류를 원인별 _ConnectionLostError로 분류해 반환한다.

    음성을 다 전송한 뒤의 오류와 예상하지 못한 오류는 다시 연결해도 해결되지 않으므로,
    분류하지 않고 원래 오류를 그대로 반환한다.
    """
    expected = (aiohttp.ClientError, OSError, TimeoutError, SttError)
    if isinstance(error, _ConnectionLostError) or role is None or ended.is_set():
        return error
    if not isinstance(error, expected):
        return error
    if isinstance(error, _SonioxResponseError):
        lost = _ConnectionLostError(LostReason.SONIOX_ERROR, f"code={error.code}")
    elif isinstance(error, _ClosedError):
        lost = _ConnectionLostError(LostReason.CLOSED)
    else:
        lost = _ConnectionLostError(role, type(error).__name__)
    lost.__cause__ = error
    return lost
