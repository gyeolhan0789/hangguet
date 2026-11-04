"""면접 에이전트 음성 처리의 단계별 CPU를 로컬 LiveKit 방에서 잰다(report/agent-audio-2026-11-04.md).

에이전트와 같은 방식으로 지원자 음성을 받고(16kHz) 질문 음성을 내보내며, 단계마다 PHASE초 동안 이 프로세스가 쓴
CPU 시간(모든 스레드, LiveKit Rust 포함) ÷ 경과 시간 = 코어 사용률을 찍는다. 인자는 음성 조각 길이(ms, 기본 100).

    ai/.venv/Scripts/python.exe loadtest/agent-audio/room_agent.py 10
"""

import asyncio
import os
import ssl
import sys
import tempfile
import time
from pathlib import Path

# 운영 작업 프로세스처럼 지표를 multiprocess(파일) 모드로 기록한다
os.environ["PROMETHEUS_MULTIPROC_DIR"] = tempfile.mkdtemp(prefix="agent-audio-prom-")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ai"))

import aiohttp  # noqa: E402
import numpy as np  # noqa: E402
from livekit import api, rtc  # noqa: E402

from app.agent.main import audio_chunks  # noqa: E402
from app.agent.stt import SAMPLE_RATE, SonioxSTT, SttSettings  # noqa: E402

URL = "ws://127.0.0.1:7880"
ROOM = "agent-audio"
PHASE = 30
CHUNK_MS = int(sys.argv[1]) if len(sys.argv) > 1 else 100
QUESTION_RATE = 24000


def token(identity: str) -> str:
    return (
        api.AccessToken("devkey", "secret")
        .with_identity(identity)
        .with_grants(api.VideoGrants(room_join=True, room=ROOM))
        .to_jwt()
    )


async def measure(name: str, work=None) -> None:
    task = asyncio.create_task(work()) if work else None
    await asyncio.sleep(2)  # 시작 직후는 빼고 잰다
    start_cpu, start_wall = time.process_time(), time.perf_counter()
    await asyncio.sleep(PHASE)
    used = time.process_time() - start_cpu
    wall = time.perf_counter() - start_wall
    if task:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    print(f"{name:<44} {used / wall * 100:6.2f}% 코어", flush=True)


class NoopWs:
    async def send_bytes(self, _):
        pass

    async def send_str(self, _):
        pass


async def main() -> None:
    print(f"음성 조각 {CHUNK_MS}ms", flush=True)
    room = rtc.Room()
    await room.connect(URL, token("interviewer"), rtc.RoomOptions(auto_subscribe=False))
    while "candidate" not in room.remote_participants:
        await asyncio.sleep(0.2)
    candidate = room.remote_participants["candidate"]
    while not candidate.track_publications:
        await asyncio.sleep(0.2)

    await measure("0. 방 연결만")
    for pub in candidate.track_publications.values():
        if pub.source == rtc.TrackSource.SOURCE_MICROPHONE:
            pub.set_subscribed(True)
    await asyncio.sleep(2)
    await measure("1. + 지원자 마이크 구독")

    def stream() -> rtc.AudioStream:
        return rtc.AudioStream.from_participant(
            participant=candidate,
            track_source=rtc.TrackSource.SOURCE_MICROPHONE,
            sample_rate=SAMPLE_RATE,
            num_channels=1,
            frame_size_ms=CHUNK_MS,
        )

    async def frames_only():
        s = stream()
        try:
            async for _ in s:
                pass
        finally:
            await s.aclose()

    async def answer(ws):
        # 에이전트의 답변 듣기와 같은 길: audio_chunks → PCM 쌓기 → STT 전송(_send) · 과금 지표
        s = stream()
        pcm = bytearray()

        async def recorded():
            async for chunk in audio_chunks(s, asyncio.Event()):
                pcm.extend(chunk)
                yield chunk

        try:
            await SonioxSTT(SttSettings(api_key="local"))._send(ws, recorded(), asyncio.Event())
        finally:
            await s.aclose()

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    async def answer_tls():
        async with (
            aiohttp.ClientSession() as session,
            session.ws_connect("wss://127.0.0.1:8765/ws", ssl=ctx) as ws,
        ):
            await answer(ws)

    await measure("2. + 16kHz로 음성 조각 받기", frames_only)
    await measure("3. + 우리 코드(조각 넘기기 · PCM · 지표)", lambda: answer(NoopWs()))
    await measure("4. + STT로 TLS 전송 = 답변 듣는 동안", answer_tls)

    source = rtc.AudioSource(QUESTION_RATE, 1)
    track = rtc.LocalAudioTrack.create_audio_track("question", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    rng = np.random.default_rng(1)
    pcm24 = (rng.standard_normal(QUESTION_RATE * 10) * 3000).astype(np.int16).tobytes()
    size = QUESTION_RATE * CHUNK_MS // 1000
    frames = [
        rtc.AudioFrame(pcm24[i : i + size * 2], QUESTION_RATE, 1, size)
        for i in range(0, len(pcm24) - size * 2 + 1, size * 2)
    ]

    async def speak():
        while True:
            for frame in frames:
                await source.capture_frame(frame)

    await measure("5. 질문 음성 내보내기(24kHz)", speak)
    await room.disconnect()


asyncio.run(main())
