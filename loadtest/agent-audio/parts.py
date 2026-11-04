"""에이전트 음성 처리 중 LiveKit 서버 없이 잴 수 있는 부분의 CPU를 잰다(report/agent-audio-2026-11-04.md).

결과는 '오디오 1초를 처리하는 데 든 CPU 초' = 그 일을 계속할 때 쓰는 코어 수. Opus는 LiveKit Agents와 함께
설치되는 PyAV(libopus)로 잰다.

    ai/.venv/Scripts/python.exe loadtest/agent-audio/parts.py
"""

import asyncio
import base64
import os
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

# 운영 작업 프로세스처럼 지표를 multiprocess(파일) 모드로 기록한다
os.environ["PROMETHEUS_MULTIPROC_DIR"] = tempfile.mkdtemp(prefix="agent-audio-prom-")
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ai"))

import av  # noqa: E402
import numpy as np  # noqa: E402
from livekit import rtc  # noqa: E402

SECONDS = 60
rng = np.random.default_rng(0)


def speechlike(rate: int, seconds: int) -> np.ndarray:
    """말소리 비슷한 신호(기본음이 흔들리는 성분 + 잡음, 0.3초마다 쉼)."""
    t = np.arange(rate * seconds) / rate
    f0 = 140 + 30 * np.sin(2 * np.pi * 0.5 * t)
    voice = sum(np.sin(2 * np.pi * k * np.cumsum(f0) / rate) / k for k in range(1, 8))
    gate = (np.sin(2 * np.pi * 1.6 * t) > -0.3).astype(float)
    x = 0.25 * voice * gate + 0.02 * rng.standard_normal(t.size)
    return np.clip(x * 32767, -32768, 32767).astype(np.int16)


def cpu(fn, repeat=3):
    best = None
    for _ in range(repeat):
        start = time.process_time()
        fn()
        used = time.process_time() - start
        best = used if best is None else min(best, used)
    return best


def report(name, cpu_seconds, audio_seconds=SECONDS):
    print(f"{name:<42} {cpu_seconds / audio_seconds * 100:7.3f}% 코어  (CPU {cpu_seconds:.3f}s / 오디오 {audio_seconds}s)")


# 1. Opus 압축(브라우저 쪽 일이지만 패킷을 만들려고) → 풀기(에이전트가 받는 일)
pcm48 = speechlike(48000, SECONDS)


def opus_packets(pcm: np.ndarray, rate: int):
    enc = av.CodecContext.create("libopus", "w")
    enc.sample_rate = rate
    enc.layout = "mono"
    enc.format = "s16"
    enc.bit_rate = 32000
    enc.options = {"frame_duration": "20", "application": "voip"}
    packets = []
    step = rate // 50
    for i in range(0, len(pcm) - step + 1, step):
        frame = av.AudioFrame.from_ndarray(pcm[i : i + step].reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = rate
        frame.pts = i
        packets += enc.encode(frame)
    packets += enc.encode(None)
    return packets


packets = opus_packets(pcm48, 48000)
print(f'Opus 패킷 {len(packets)}개, 평균 {sum(p.size for p in packets) / len(packets):.0f}바이트')


def decode_opus():
    dec = av.CodecContext.create("libopus", "r")
    dec.sample_rate = 48000
    dec.layout = "mono"
    for p in packets:
        dec.decode(p)


report("1. Opus 풀기(48kHz, 지원자 음성 받기)", cpu(decode_opus))

# 2. 48kHz → 16kHz 바꾸기(LiveKit SDK 리샘플러, AudioStream(sample_rate=16000)과 같은 일)
frames48 = [
    rtc.AudioFrame(pcm48[i : i + 480].tobytes(), 48000, 1, 480) for i in range(0, len(pcm48), 480)
]


def resample():
    r = rtc.AudioResampler(48000, 16000, num_channels=1)
    for f in frames48:
        r.push(f)
    r.flush()


report("2. 48k→16k 바꾸기(SDK 리샘플러, 10ms씩)", cpu(resample))

# 3. 우리 파이썬 코드: audio_chunks → PCM 쌓기 → STT 전송(_send) + 과금 지표, 10ms 조각 6000개
from app.agent.main import audio_chunks  # noqa: E402
from app.agent.stt import SonioxSTT, SttSettings  # noqa: E402

pcm16 = speechlike(16000, SECONDS).tobytes()
chunk = 320  # 16kHz 10ms


class FakeStream:
    def __init__(self):
        self.i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.i >= len(pcm16):
            raise StopAsyncIteration
        data = pcm16[self.i : self.i + chunk]
        self.i += chunk
        return SimpleNamespace(frame=SimpleNamespace(data=memoryview(data)))


class FakeWs:
    async def send_bytes(self, _):
        pass

    async def send_str(self, _):
        pass


async def python_path():
    closed = asyncio.Event()
    pcm = bytearray()

    async def recorded():
        async for c in audio_chunks(FakeStream(), closed):
            pcm.extend(c)
            yield c

    stt = SonioxSTT(SttSettings(api_key="local"))
    await stt._send(FakeWs(), recorded(), asyncio.Event())


report("3. 음성 넘기기(파이썬, 초당 100조각)", cpu(lambda: asyncio.run(python_path())))

# 4. 질문 음성: 24kHz PCM → 10ms 프레임 만들기 + Opus 압축(48kHz로 바꾼 뒤, WebRTC가 보내는 형식)
from app.agent.question import audio_frames  # noqa: E402

pcm24 = speechlike(24000, SECONDS).tobytes()
report("4a. 질문 음성 프레임 만들기(파이썬)", cpu(lambda: audio_frames(pcm24)))
report("4b. Opus 압축(48kHz, 질문 음성 내보내기)", cpu(lambda: opus_packets(pcm48, 48000)))

# 5. 답변 끝 분석: 60초 답변의 억양 · 말끝 흐림(답변마다 1번)
from app.common.answer import SpeechToken  # noqa: E402
from app.interview.realtime.voice import voice_metrics  # noqa: E402

samples = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768
tokens = []
for k in range(150):  # 단어 150개, 0.4초 간격
    start = k * 400
    tokens.append(SpeechToken(" 단어" if k else "단어", start, start + 300))
tokens[-1] = SpeechToken("다.", tokens[-1].start_ms, tokens[-1].end_ms)
used = cpu(lambda: voice_metrics(samples, 16000, tokens))
print(f"{'5. 답변 끝 분석(60초 답변 1번)':<42} CPU {used * 1000:.1f}ms / 답변 1개")

# 6. 인상 판단 사진: 40KB JPEG을 base64로(1초에 1장)
jpeg = rng.integers(0, 256, 40_000, dtype=np.uint8).tobytes()
used = cpu(lambda: [base64.b64encode(jpeg).decode("ascii") for _ in range(SECONDS)])
report("6. 사진 base64(1초 1장)", used)
