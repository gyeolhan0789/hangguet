"""STT 전체 텍스트를 지원자에게 보내며 대기 중인 갱신은 최신 하나만 유지한다."""

import asyncio
import json
import logging
from typing import Literal
from uuid import uuid4

from livekit import rtc

log = logging.getLogger(__name__)
TRANSCRIPT_TOPIC = "interview.stt"
SEND_TIMEOUT = 5


class TranscriptPublisher:
    def __init__(self, participant: rtc.LocalParticipant, destination: str) -> None:
        self._participant = participant
        self._destination = destination
        self._stream_id = str(uuid4())
        self._revision = 0
        self._confirmed = ""
        self._interim = ""
        self._pending: str | None = None
        self._ready = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()
        self._task = asyncio.create_task(self._send())
        self.update("", "")

    def update(
        self, confirmed: str, interim: str, state: Literal["listening", "failed"] = "listening"
    ) -> None:
        self._confirmed = confirmed
        self._interim = interim
        self._revision += 1
        self._pending = json.dumps(
            {
                "streamId": self._stream_id,
                "revision": self._revision,
                "confirmedText": confirmed,
                "interimText": interim,
                "state": state,
            },
            ensure_ascii=False,
        )
        self._idle.clear()
        self._ready.set()

    def fail(self) -> None:
        self.update(self._confirmed, self._interim, "failed")

    async def _send(self) -> None:
        while True:
            await self._ready.wait()
            self._ready.clear()
            payload = self._pending
            self._pending = None
            if payload is not None:
                try:
                    await asyncio.wait_for(
                        self._participant.send_text(
                            payload,
                            topic=TRANSCRIPT_TOPIC,
                            destination_identities=[self._destination],
                        ),
                        timeout=SEND_TIMEOUT,
                    )
                except Exception:
                    # 전송 오류에 포함될 수 있는 답변 원문은 기록하지 않는다.
                    log.warning("STT 화면 전달 실패")
            if self._pending is None:
                self._idle.set()

    async def aclose(self) -> None:
        try:
            await asyncio.wait_for(self._idle.wait(), timeout=SEND_TIMEOUT)
        except TimeoutError:
            pass
        finally:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
