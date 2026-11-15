"""그룹 다시보기 구간이 실제 말소리와 일치하는지 확인한다(report/group-ai-2026-11-15.md).

합친 영상(본인 답변 구간만 이어 붙인 mp4)의 소리에서
말소리가 없는 구간을 찾고(ffmpeg silencedetect),
구간(segments[]의 videoStart · videoEnd)마다 측정한다.
- 앞: videoStart부터 첫 말소리(면접관 질문)까지.
  크면 질문 앞부분이 아닌 침묵이 포함된 것이다
- 뒤: 지원자가 발화를 멈춘 시각부터 videoEnd까지.
  에이전트는 7초 침묵이면 답변을 종료하므로 7초 이상이 정상이고,
  7초보다 짧으면 답변 끝이 잘린 것이다
AI 이미지(ffmpeg 포함) 컨테이너에서 실행한다. 인자는 BE 주소, 비밀번호, '세션id:이메일' 목록이다.

    docker run --rm --network <망> -v "<레포>/loadtest/group-ai:/w:ro" <AI 이미지> \\
      python /w/segments.py http://<BE>:8080/api/v1 <비밀번호> 36:load-...@test.local ...
"""

import json
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

# 말소리 판정 기준. 가짜 마이크 음성은 잡음이 없는 합성음이므로 -35dB 미만을 침묵으로 판정한다
NOISE_DB = -35
MIN_SILENCE = 0.3


def call(
    base: str, method: str, path: str, body: dict | None = None, token: str | None = None
) -> dict:
    req = urllib.request.Request(
        base + path, method=method, data=json.dumps(body).encode() if body else None
    )
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read())


def silences(path: str) -> tuple[list[tuple[float, float]], float]:
    out = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            path,
            "-af",
            f"silencedetect=noise={NOISE_DB}dB:d={MIN_SILENCE}",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    duration = float(
        subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )
    if len(ends) < len(starts):
        ends.append(duration)
    return list(zip(starts, ends, strict=True)), duration


def speech_in(
    window: tuple[float, float], quiet: list[tuple[float, float]]
) -> tuple[float, float] | None:
    """window 안에서 말소리가 있는 첫 시각과 마지막 시각."""
    a, b = window
    spans = []
    cursor = a
    for s, e in quiet:
        if e <= a or s >= b:
            continue
        if s > cursor:
            spans.append((cursor, min(s, b)))
        cursor = max(cursor, e)
    if cursor < b:
        spans.append((cursor, b))
    spans = [x for x in spans if x[1] - x[0] > 0.05]
    return (spans[0][0], spans[-1][1]) if spans else None


def main() -> None:
    base, password = sys.argv[1], sys.argv[2]
    rows = []
    for pair in sys.argv[3:]:
        session_id, email = pair.split(":", 1)
        token = call(base, "POST", "/auth/login", {"email": email, "password": password})[
            "accessToken"
        ]
        try:
            replay = call(base, "GET", f"/interview-sessions/{session_id}/replay", token=token)
        except urllib.error.HTTPError as e:
            # 결과 생성이 실패한 면접은 다시보기도 409로 응답한다(API 명세 6.4)
            rows.append({"session": int(session_id), "status": f"HTTP {e.code}"})
            continue
        if replay.get("videoStatus") != "READY":
            rows.append({"session": int(session_id), "status": replay.get("videoStatus")})
            continue
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            with urllib.request.urlopen(replay["videoUrl"], timeout=60) as res:
                f.write(res.read())
            f.flush()
            quiet, duration = silences(f.name)
        for seg in replay["segments"]:
            start, end = seg["videoStart"], seg["videoEnd"]
            speech = speech_in((start, end), quiet)
            # 구간 안의 마지막 긴 침묵(5초 이상)이 답변 끝 침묵이고,
            # 그 시작이 지원자가 발화를 멈춘 시각이다.
            # 마이크 파일은 답변 사이에 8초 침묵하므로,
            # 구간 끝이 늦으면 그 뒤 다음 답변 소리가 구간에 포함된다
            long_quiet = [
                (s, e)
                for s, e in quiet
                if s < end and e > start and min(e, end) - max(s, start) >= 5
            ]
            stop = long_quiet[-1][0] if long_quiet else None
            rows.append(
                {
                    "session": int(session_id),
                    "seq": seg["seq"],
                    "length": round(end - start, 2),
                    "lead": round(speech[0] - start, 2) if speech else None,
                    "tail": round(end - speech[1], 2) if speech else None,
                    "speechStopToEnd": round(end - stop, 2) if stop is not None else None,
                }
            )
        rows.append({"session": int(session_id), "videoSeconds": round(duration, 2)})
    print(json.dumps(rows, ensure_ascii=False))


if __name__ == "__main__":
    main()
