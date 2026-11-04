"""지원자 역할: 로컬 LiveKit 방에 들어가 말소리 비슷한 마이크 음성(48kHz)을 실시간으로 계속 보낸다.

room_agent.py와 함께 쓴다. 인자는 보낼 시간(초, 기본 230).

    ai/.venv/Scripts/python.exe loadtest/agent-audio/room_candidate.py 230
"""

import asyncio
import sys

import numpy as np
from livekit import api, rtc

URL = "ws://127.0.0.1:7880"
ROOM = "agent-audio"
SECONDS = int(sys.argv[1]) if len(sys.argv) > 1 else 230


def token(identity: str) -> str:
    return (
        api.AccessToken("devkey", "secret")
        .with_identity(identity)
        .with_grants(api.VideoGrants(room_join=True, room=ROOM))
        .to_jwt()
    )


def speechlike(rate: int, seconds: int) -> np.ndarray:
    """기본음이 흔들리는 성분 + 잡음, 0.3초마다 쉰다(실제 말소리 대신 쓰는 지어낸 신호)."""
    rng = np.random.default_rng(0)
    t = np.arange(rate * seconds) / rate
    f0 = 140 + 30 * np.sin(2 * np.pi * 0.5 * t)
    voice = sum(np.sin(2 * np.pi * k * np.cumsum(f0) / rate) / k for k in range(1, 8))
    gate = (np.sin(2 * np.pi * 1.6 * t) > -0.3).astype(float)
    x = 0.25 * voice * gate + 0.02 * rng.standard_normal(t.size)
    return np.clip(x * 32767, -32768, 32767).astype(np.int16)


async def main() -> None:
    room = rtc.Room()
    await room.connect(URL, token("candidate"))
    source = rtc.AudioSource(48000, 1)
    track = rtc.LocalAudioTrack.create_audio_track("mic", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    pcm = speechlike(48000, 20)
    i = 0
    for _ in range(SECONDS * 100):
        await source.capture_frame(rtc.AudioFrame(pcm[i : i + 480].tobytes(), 48000, 1, 480))
        i = (i + 480) % (len(pcm) - 480)
    await room.disconnect()


asyncio.run(main())
