"""Egress 트랙(지원자 영상·음성, 면접관 음성)을 ffmpeg로 mp4 하나로 합친다(AI 명세 7장).

- 트랙 파일은 이름 앞부분으로 찾는다.
  트랙 id는 LiveKit 서버가 붙이므로 미리 알 수 없고, 확장자는 코덱마다 다르기 때문이다(AI 명세 7장).
- 같은 종류의 파일이 여러 개이면 합치지 않는다.
  재접속으로 생긴 파일의 녹화 시작 순서를 지금 파일 이름으로는 알 수 없어,
  순서를 추측해 이어 붙이면 지원자 화면과 면접관 음성이 어긋난 녹화가 만들어지기 때문이다.
- 다시보기에서 두 사람의 음성을 함께 재생하므로
  면접관 음성과 지원자 음성을 한 음성 트랙으로 혼합한다.
- 영상은 다시 인코딩하지 않고 복사한다.
  다시 인코딩하면 합치기가 면접 길이에 비례해 오래 걸려
  뒤에 대기한 작업이 밀리기 때문이다(AI 명세 7장).
"""

import subprocess
from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class TrackKind(StrEnum):
    """트랙 파일 이름의 앞부분(AI 명세 7장 원본 트랙 파일)."""

    CANDIDATE_VIDEO = "candidate-video-"
    CANDIDATE_AUDIO = "candidate-audio-"
    INTERVIEWER_AUDIO = "interviewer-audio-"


# ffmpeg 디코더·필터·인코더가 각각 사용하는 스레드 수.
# 같은 서버에서 다른 면접의 실시간 처리가 진행 중일 수 있으므로
# 합치기가 CPU를 모두 사용하지 않게 제한한다
FFMPEG_THREADS = 2
# 합치기 시간 상한(초, 임시 값).
# 영상 복사로 15분 면접 녹화를 86~91초에 합쳤으므로 3배 이상 여유를 두되,
# ffmpeg가 멈췄을 때 뒤에 대기한 다른 면접의 작업이 오래 밀리지 않게 한다
MERGE_TIMEOUT_SECONDS = 300.0
# 오류 메시지에 포함하는 ffmpeg 표준 오류의 최대 길이
STDERR_TAIL_CHARS = 2000


class MissingTrackError(Exception):
    """원본 위치에 어떤 종류의 트랙 파일이 없다."""


class MultipleTracksError(Exception):
    """같은 종류의 트랙 파일이 여러 개라 이어 붙일 순서를 알 수 없다."""


class MergeError(Exception):
    """ffmpeg 실행에 실패해 mp4를 생성하지 못했다."""


@dataclass(frozen=True)
class Tracks:
    """종류마다 하나인 트랙 파일의 저장소 키."""

    candidate_video: str
    candidate_audio: str
    interviewer_audio: str


def select_tracks(keys: Iterable[str], raw_prefix: str) -> Tracks:
    """원본 위치 바로 아래의 파일 중 종류마다 하나인 트랙을 고른다.

    한 종류라도 없으면 MissingTrackError, 같은 종류가 여러 개이면 MultipleTracksError다.
    """
    found: dict[TrackKind, list[str]] = {kind: [] for kind in TrackKind}
    for key in keys:
        name = key.removeprefix(raw_prefix)
        # 다른 면접이나 하위 폴더의 파일을 합치지 않도록 원본 위치 바로 아래의 파일만 본다
        if name == key or "/" in name:
            continue
        for kind in TrackKind:
            if name.startswith(kind.value):
                found[kind].append(key)
    missing = [kind.name for kind, files in found.items() if not files]
    if missing:
        raise MissingTrackError(f"트랙이 없다: {', '.join(missing)}")
    multiple = [kind.name for kind, files in found.items() if len(files) > 1]
    if multiple:
        raise MultipleTracksError(f"같은 종류의 트랙이 여러 개다: {', '.join(multiple)}")
    return Tracks(
        candidate_video=found[TrackKind.CANDIDATE_VIDEO][0],
        candidate_audio=found[TrackKind.CANDIDATE_AUDIO][0],
        interviewer_audio=found[TrackKind.INTERVIEWER_AUDIO][0],
    )


def build_merge_command(
    video: Path,
    candidate_audio: Path,
    interviewer_audio: Path,
    output: Path,
    *,
    ffmpeg: str = "ffmpeg",
    threads: int = FFMPEG_THREADS,
) -> list[str]:
    """트랙 세 개를 합치는 ffmpeg 명령이다."""
    # amix는 기본적으로 입력 수로 음량을 나누므로,
    # 한 사람만 발화하는 구간의 음량이 절반이 되지 않도록 normalize=0으로 둔다.
    # 두 음성 중 더 긴 쪽까지 남기도록 duration=longest로 둔다
    mix = "[1:a][2:a]amix=inputs=2:duration=longest:normalize=0[a]"
    # -threads는 바로 뒤에 지정한 입력 또는 출력에만 적용되므로 입력마다 지정한다
    inputs: list[str] = []
    for track in (video, candidate_audio, interviewer_audio):
        inputs += ["-threads", str(threads), "-i", str(track)]
    return [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-filter_complex_threads",
        str(threads),
        *inputs,
        "-filter_complex",
        mix,
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-threads",
        str(threads),
        # 다시보기에서 파일 전체를 다운로드하기 전에 재생을 시작하도록 색인을 파일 앞에 둔다
        "-movflags",
        "+faststart",
        str(output),
    ]


def merge_tracks(
    video: Path,
    candidate_audio: Path,
    interviewer_audio: Path,
    output: Path,
    *,
    ffmpeg: str = "ffmpeg",
    timeout_seconds: float = MERGE_TIMEOUT_SECONDS,
) -> None:
    """트랙을 합쳐 output에 mp4를 생성한다.

    실패하면 MergeError를 발생시킨다.
    """
    command = build_merge_command(video, candidate_audio, interviewer_audio, output, ffmpeg=ffmpeg)
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout_seconds, check=False
        )
    except FileNotFoundError as e:
        raise MergeError(f"ffmpeg를 실행할 수 없다: {ffmpeg}") from e
    except subprocess.TimeoutExpired as e:
        # subprocess.run은 시간 초과 시 ffmpeg 프로세스를 종료한 뒤 이 예외를 발생시킨다
        raise MergeError(f"ffmpeg가 {timeout_seconds:.0f}초 안에 끝나지 않았다") from e
    if completed.returncode != 0:
        raise MergeError(
            f"ffmpeg 종료 코드 {completed.returncode}: {completed.stderr[-STDERR_TAIL_CHARS:]}"
        )
    # 종료 코드가 0이어도 출력이 비어 있으면 업로드할 녹화가 없으므로 실패로 처리한다
    if not output.is_file() or output.stat().st_size == 0:
        raise MergeError("ffmpeg가 출력 파일을 생성하지 않았다")
