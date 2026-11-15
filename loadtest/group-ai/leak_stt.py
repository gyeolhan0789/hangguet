"""다른 참가자 목소리가 답변자 마이크에 유입되었을 때 Soniox가 그 말을 전사하는지 측정한다.

보고서는 report/group-ai-2026-11-15.md다.
답변자(u1) 답변에 다른 참가자(u2) 목소리를 -30 · -20 · -10dB(답변자 음성 실효값 대비)로 합성한다.
에이전트와 같은 Soniox 연결(app.agent.stt)로 실시간 속도에 맞춰 전송하고,
전사에 u2 주제 낱말(answers.json)이 나오는지 집계한다.
브라우저 에코 제거(livekit-client 기본 echoCancellation)를 거치지 않은 단순 합성이므로,
스피커로 나온 상대 목소리가 마이크로 유입되는 실제 경로보다 섞임이 크게 측정되는 최악의 상한이다.

    SONIOX_API_KEY=... ai/.venv/Scripts/python.exe loadtest/group-ai/leak_stt.py
"""

import asyncio
import json
import os
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ai"))

from app.agent.stt import SAMPLE_RATE, SonioxSTT, SttSettings  # noqa: E402

HERE = Path(__file__).resolve().parent
SPEC = json.loads((HERE / "answers.json").read_text(encoding="utf-8"))
KEYWORDS = {p["id"]: p["keywords"] for p in SPEC["participants"]}
LEVELS_DB = (None, -30, -20, -10)
CLIPS = 3
CLIP_SECONDS = 25
CHUNK_MS = 100


def load(name: str) -> np.ndarray:
    with wave.open(str(HERE / "media" / f"{name}.wav")) as w:
        rate = w.getframerate()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
    step = rate // SAMPLE_RATE
    return pcm[: len(pcm) // step * step].reshape(-1, step).mean(axis=1)


def rms(x: np.ndarray) -> float:
    voiced = x[np.abs(x) > 300]
    return float(np.sqrt(np.mean(voiced**2))) if len(voiced) else 1.0


async def transcribe(audio: np.ndarray) -> str:
    stt = SonioxSTT(SttSettings.from_env(os.environ))
    pcm = np.clip(audio, -32768, 32767).astype(np.int16).tobytes()
    size = SAMPLE_RATE * 2 * CHUNK_MS // 1000

    async def feed():
        for i in range(0, len(pcm), size):
            yield pcm[i : i + size]
            await asyncio.sleep(CHUNK_MS / 1000)

    await stt.run(feed())
    return stt.text


async def main() -> None:
    u1, u2 = load("u1"), load("u2")
    n = CLIP_SECONDS * SAMPLE_RATE
    rows = []
    for clip in range(CLIPS):
        own = u1[clip * n : (clip + 1) * n]
        other = u2[clip * n : (clip + 1) * n]
        for level in LEVELS_DB:
            mixed = (
                own.copy()
                if level is None
                else own + other * (rms(own) / rms(other)) * 10 ** (level / 20)
            )
            text = await transcribe(mixed)
            rows.append(
                {
                    "clip": clip + 1,
                    "levelDb": level,
                    "ownWords": [k for k in KEYWORDS["u1"] if k in text],
                    "otherWords": [k for k in KEYWORDS["u2"] if k in text],
                    "chars": len(text),
                }
            )
            print(json.dumps(rows[-1], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
