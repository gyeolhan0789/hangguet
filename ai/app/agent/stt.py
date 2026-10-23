"""Soniox에 음성을 전송하고, 수신한 응답을 전사 상태(Transcript)에 반영한다.

확정 토큰 고르기·시각 보정은 app.interview.realtime.transcript가 담당하고,
이 모듈은 Soniox 연결과 화면 갱신만 맡는다.
같은 응답을 두 곳에서 따로 해석하면 한쪽만 변경됐을 때 화면 글과 답변 글이 어긋나기 때문이다.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

import aiohttp

from app.interview.realtime.transcript import Transcript, soniox_tokens

log = logging.getLogger(__name__)
SONIOX_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
SAMPLE_RATE = 16000


class SttError(RuntimeError):
    """음성 인식을 계속할 수 없다."""


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
        self, settings: SttSettings, *, on_update: Callable[[str, str], None] | None = None
    ) -> None:
        self.settings = settings
        # 연결 하나의 전사 상태다.
        # 자동 재연결이 없으므로 연결 시작 시각(offset)은 0이다
        self.transcript = Transcript()
        self.transcript.begin_connection(0)
        self._on_update = on_update

    @property
    def text(self) -> str:
        """확정 글."""
        return self.transcript.confirmed_text

    @property
    def interim_text(self) -> str:
        """마지막 응답의 미확정 글."""
        return self.transcript.interim_text

    def accept_response(self, response: dict[str, Any]) -> bool:
        """중간 결과는 교체하고 확정 토큰만 누적한다. 종료 응답이면 True."""
        if response.get("error_code") or response.get("error_message"):
            # 공급자 메시지에는 입력값이 포함될 수 있어 원문을 로그에 남기지 않는다.
            raise SttError(f"Soniox STT 오류 (code={response.get('error_code', 'unknown')})")
        before = self.transcript.final_count
        self.transcript.apply(soniox_tokens(response))
        confirmed = self.transcript.final_count - before
        if self._on_update is not None:
            self._on_update(self.text, self.interim_text)
        if confirmed:
            log.info("STT 확정 토큰 수신", extra={"token_count": confirmed})
        return response.get("finished") is True

    async def run(self, audio: AsyncIterable[bytes]) -> None:
        """16kHz·모노·PCM s16le 스트림을 보내고 종료 응답까지 받는다."""
        async with (
            aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session,
            session.ws_connect(
                SONIOX_URL,
                headers={"Authorization": f"Bearer {self.settings.api_key}"},
                heartbeat=20,
                timeout=aiohttp.ClientWSTimeout(ws_close=5),
            ) as ws,
        ):
            await asyncio.wait_for(
                ws.send_json(
                    {
                        "model": self.settings.model,
                        "audio_format": "pcm_s16le",
                        "sample_rate": SAMPLE_RATE,
                        "num_channels": 1,
                        "language_hints": ["ko"],
                        "enable_endpoint_detection": True,
                    }
                ),
                timeout=10,
            )
            log.info("Soniox STT 연결 완료")
            ended = asyncio.Event()
            tasks = [
                asyncio.create_task(self._send(ws, audio, ended)),
                asyncio.create_task(self._receive(ws)),
                asyncio.create_task(self._keepalive(ws, ended)),
            ]
            sender, receiver, keepalive = tasks
            try:
                # 음성 입력이나 서버 응답 중 어느 쪽이 실패해도 나머지를 정리한다.
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
                if receiver in done and not ended.is_set():
                    raise SttError("Soniox STT 스트림이 음성 입력보다 먼저 종료됐습니다")
                if keepalive in done and not ended.is_set():
                    raise SttError("Soniox STT keepalive가 종료됐습니다")
                await sender
                await asyncio.wait_for(receiver, timeout=15)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)

    async def _send(
        self, ws: aiohttp.ClientWebSocketResponse, audio: AsyncIterable[bytes], ended: asyncio.Event
    ) -> None:
        async for chunk in audio:
            await asyncio.wait_for(ws.send_bytes(chunk), timeout=10)
        ended.set()
        await asyncio.wait_for(ws.send_str(""), timeout=10)

    async def _receive(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        async for message in ws:
            if message.type == aiohttp.WSMsgType.TEXT:
                if self.accept_response(message.json()):
                    return
            elif message.type == aiohttp.WSMsgType.ERROR:
                raise SttError("Soniox STT WebSocket 수신 오류")
        raise SttError("Soniox STT가 종료 응답 없이 연결을 닫았습니다")

    async def _keepalive(self, ws: aiohttp.ClientWebSocketResponse, ended: asyncio.Event) -> None:
        while not ended.is_set():
            try:
                await asyncio.wait_for(ended.wait(), timeout=5)
            except TimeoutError:
                await asyncio.wait_for(ws.send_json({"type": "keepalive"}), timeout=10)
