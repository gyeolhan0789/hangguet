"""Egress 트랙(지원자 영상·음성, 면접관 음성)을 ffmpeg로 mp4 하나로 합친다(AI 명세 7장).

- 트랙 파일은 이름 앞부분으로 찾는다.
  트랙 id는 LiveKit 서버가 붙이므로 미리 알 수 없고, 확장자는 코덱마다 다르기 때문이다(AI 명세 7장).
- 녹화 목록 조회로 트랙별 녹화 시작 시각을 얻으면
  세 종류 트랙 중 가장 이른 시각(T0)을 0초로 두고 각 트랙을 시작 시각 위치에 배치한다.
  T0는 결과 메시지로 BE에 전달되어 다시보기의 영상 0초(recordingStartedAt)가 된다(AI 명세 7장).
  면접관 트랙이 지원자 트랙보다 먼저 시작한 시차와 재접속으로 끊긴 구간을 그대로 남겨
  지원자 화면과 두 사람의 음성이 어긋나지 않게 하기 위함이다.
  - 같은 종류 트랙 사이 빈 구간은 음성은 무음으로 채우고,
    영상은 타임스탬프를 유지해 직전 프레임이 이어서 표시되게 한다.
  - 같은 종류 트랙이 겹치면 뒤 트랙이 시작하는 위치에서 앞 트랙을 자른다.
    재접속한 쪽이 지금 연결이므로 뒤 트랙을 온전히 남긴다.
  - 영상을 자르는 위치(outpoint)는 파일 안의 타임스탬프이므로 파일마다 첫 타임스탬프를 읽어 더한다.
    Egress 파일의 첫 타임스탬프가 0이라는 보장이 없기 때문이다.
- 녹화 시작 시각을 얻지 못하면 같은 종류의 파일을 저장소에 저장된 시각 순서로 이어 붙인다.
  파일 이름의 트랙 id로는 순서를 알 수 없고 저장소 목록에는 녹화 시작 시각이 없으므로
  먼저 끝난 트랙이 먼저 시작했다고 간주한다.
  이 경우 빈 구간을 알 수 없으므로 채우지 않고 바로 이어 붙인다.
- 다시보기에서 두 사람의 음성을 함께 재생하므로
  면접관 음성과 지원자 음성을 한 음성 트랙으로 혼합한다.
- 영상은 다시 인코딩하지 않고 복사한다.
  다시 인코딩하면 합치기가 면접 길이에 비례해 오래 걸려
  뒤에 대기한 작업이 밀리기 때문이다(AI 명세 7장).
  그래서 영상 여러 개는 다시 인코딩이 필요한 concat 필터 대신 concat 형식 입력으로 이어 붙인다.
"""

import subprocess
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from functools import partial
from pathlib import Path

from app.recording.storage import StoredObject


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
# 영상 첫 타임스탬프를 읽는 시간 상한(초, 임시 값). 파일 머리만 읽으므로 짧게 둔다
PROBE_TIMEOUT_SECONDS = 30.0
# 오류 메시지에 포함하는 ffmpeg 표준 오류의 최대 길이
STDERR_TAIL_CHARS = 2000
# 영상을 ffmpeg concat 형식 입력으로 전달할 때 작성하는 목록 파일 이름
VIDEO_LIST_FILE = "candidate-video.txt"


class MissingTrackError(Exception):
    """원본 위치에 어떤 종류의 트랙 파일이 없다."""


class MergeError(Exception):
    """ffmpeg 실행에 실패해 mp4를 생성하지 못했다."""


@dataclass(frozen=True)
class Tracks:
    """종류마다 저장소에 저장된 시각 순서로 정렬한 트랙 파일의 저장소 키."""

    candidate_video: tuple[str, ...]
    candidate_audio: tuple[str, ...]
    interviewer_audio: tuple[str, ...]


@dataclass(frozen=True)
class Placed[T]:
    """세 종류 트랙 중 가장 이른 녹화 시작 시각을 0초로 둔 위치(초)에 배치한 트랙."""

    track: T
    offset_seconds: float


@dataclass(frozen=True)
class PlacedTracks[T]:
    """종류마다 녹화 시작 순서로 정렬해 배치한 트랙과 0초에 해당하는 시각(T0)."""

    candidate_video: tuple[Placed[T], ...]
    candidate_audio: tuple[Placed[T], ...]
    interviewer_audio: tuple[Placed[T], ...]
    origin: datetime


def _group_by_kind(keys: Iterable[str], raw_prefix: str) -> dict[TrackKind, list[str]]:
    """원본 위치 바로 아래의 트랙 파일을 종류별로 모은다.

    한 종류라도 없으면 MissingTrackError다.
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
    return found


def select_tracks(objects: Iterable[StoredObject], raw_prefix: str) -> Tracks:
    """원본 위치 바로 아래의 파일을 종류별로 모아 저장소에 저장된 시각 순으로 정렬한다.

    한 종류라도 없으면 MissingTrackError다.
    """
    uploaded = {item.key: item.last_modified for item in objects}
    found = _group_by_kind(uploaded, raw_prefix)
    ordered = {kind: tuple(sorted(keys, key=uploaded.__getitem__)) for kind, keys in found.items()}
    return Tracks(
        candidate_video=ordered[TrackKind.CANDIDATE_VIDEO],
        candidate_audio=ordered[TrackKind.CANDIDATE_AUDIO],
        interviewer_audio=ordered[TrackKind.INTERVIEWER_AUDIO],
    )


def place_tracks(started: Iterable[tuple[str, datetime]], raw_prefix: str) -> PlacedTracks[str]:
    """(저장소 키, 녹화 시작 시각) 목록을 종류별로 모아 시작 시각 위치에 배치한다.

    세 종류 트랙 중 가장 이른 시작 시각이 0초다. 세 종류에 맞지 않는 파일은 무시한다.
    한 종류라도 없으면 MissingTrackError다.
    """
    starts = dict(started)
    found = _group_by_kind(starts, raw_prefix)
    origin = min(starts[key] for keys in found.values() for key in keys)
    placed = {
        kind: tuple(
            Placed(key, (starts[key] - origin).total_seconds())
            for key in sorted(keys, key=starts.__getitem__)
        )
        for kind, keys in found.items()
    }
    return PlacedTracks(
        candidate_video=placed[TrackKind.CANDIDATE_VIDEO],
        candidate_audio=placed[TrackKind.CANDIDATE_AUDIO],
        interviewer_audio=placed[TrackKind.INTERVIEWER_AUDIO],
        origin=origin,
    )


def _audio_input(first: int, count: int, label: str) -> tuple[str, str]:
    """입력 번호 first부터 count개인 음성을 가리키는 필터 이름과, 이어 붙이는 필터다."""
    inputs = "".join(f"[{index}:a]" for index in range(first, first + count))
    if count == 1:
        return inputs, ""
    return f"[{label}]", f"{inputs}concat=n={count}:v=0:a=1[{label}];"


def _output_args(output: Path, threads: int) -> list[str]:
    return [
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


def _command_head(ffmpeg: str, threads: int) -> list[str]:
    return [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-filter_complex_threads",
        str(threads),
    ]


def build_merge_command(
    video: Path,
    candidate_audio: Sequence[Path],
    interviewer_audio: Sequence[Path],
    output: Path,
    *,
    concat_video: bool = False,
    ffmpeg: str = "ffmpeg",
    threads: int = FFMPEG_THREADS,
) -> list[str]:
    """트랙을 합치는 ffmpeg 명령이다.

    concat_video이면 video를 영상 파일이 아니라 concat 형식 목록 파일로 읽는다.
    음성은 종류마다 주어진 순서로 이어 붙인 뒤 혼합한다.
    """
    candidate, candidate_concat = _audio_input(1, len(candidate_audio), "c")
    interviewer, interviewer_concat = _audio_input(
        1 + len(candidate_audio), len(interviewer_audio), "i"
    )
    # amix는 기본적으로 입력 수로 음량을 나누므로,
    # 한 사람만 발화하는 구간의 음량이 절반이 되지 않도록 normalize=0으로 둔다.
    # 두 음성 중 더 긴 쪽까지 남기도록 duration=longest로 둔다
    mix = (
        f"{candidate_concat}{interviewer_concat}"
        f"{candidate}{interviewer}amix=inputs=2:duration=longest:normalize=0[a]"
    )
    # -threads는 바로 뒤에 지정한 입력 또는 출력에만 적용되므로 입력마다 지정한다.
    # 목록 파일에는 임시 폴더의 절대 경로를 쓰므로 -safe 0으로 허용한다
    video_format = ["-f", "concat", "-safe", "0"] if concat_video else []
    inputs = ["-threads", str(threads), *video_format, "-i", str(video)]
    for track in (*candidate_audio, *interviewer_audio):
        inputs += ["-threads", str(threads), "-i", str(track)]
    return [
        *_command_head(ffmpeg, threads),
        *inputs,
        "-filter_complex",
        mix,
        *_output_args(output, threads),
    ]


Segment = tuple[Placed[Path], float | None]


def segments(placed: Sequence[Placed[Path]]) -> list[Segment]:
    """같은 종류 트랙마다 다음 트랙이 시작할 때까지의 길이(초)를 붙인다.

    마지막 트랙은 끝까지 사용하므로 길이가 None이다.
    다음 트랙과 같은 시각에 시작한 트랙은 남길 구간이 없으므로 제외한다.
    """
    result: list[Segment] = []
    for current, following in zip(placed, placed[1:], strict=False):
        length = following.offset_seconds - current.offset_seconds
        if length > 0:
            result.append((current, length))
    result.append((placed[-1], None))
    return result


def build_placed_merge_command(
    video_list: Path,
    video_offset_seconds: float,
    audio: Sequence[Segment],
    output: Path,
    *,
    ffmpeg: str = "ffmpeg",
    threads: int = FFMPEG_THREADS,
) -> list[str]:
    """배치한 트랙을 합치는 ffmpeg 명령이다.

    영상은 video_list(concat 형식 목록 파일)를 video_offset_seconds만큼 뒤로 미뤄 읽는다.
    음성은 구간마다 길이를 자르고 시작 위치만큼 무음을 앞에 붙인 뒤 모두 혼합한다.
    """
    # 첫 영상이 늦게 시작하면 다시 인코딩하지 않고 타임스탬프만 미룬다
    inputs = [
        "-threads",
        str(threads),
        "-itsoffset",
        f"{video_offset_seconds:.3f}",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(video_list),
    ]
    filters: list[str] = []
    for index, (placed, length) in enumerate(audio, start=1):
        trim = "" if length is None else f"atrim=end={length:.3f},"
        delay = round(placed.offset_seconds * 1000)
        # Egress 파일의 첫 타임스탬프가 0이 아닐 수 있으므로 자르기 전에 0부터 시작하게 맞춘다
        filters.append(
            f"[{index}:a]asetpts=PTS-STARTPTS,{trim}adelay=delays={delay}:all=1[a{index}]"
        )
        inputs += ["-threads", str(threads), "-i", str(placed.track)]
    labels = "".join(f"[a{index}]" for index in range(1, len(audio) + 1))
    # 같은 종류 구간은 겹치지 않게 잘랐으므로 normalize=0으로 더해도 음량이 커지지 않는다
    mix = f"{labels}amix=inputs={len(audio)}:duration=longest:normalize=0[a]"
    return [
        *_command_head(ffmpeg, threads),
        *inputs,
        "-filter_complex",
        ";".join([*filters, mix]),
        *_output_args(output, threads),
    ]


def _file_line(path: Path) -> str:
    # 목록 형식에서 작은따옴표는 따옴표를 닫고 \'로 작성한 뒤 다시 열어야 한다
    return "file '" + str(path).replace("'", "'\\''") + "'\n"


def write_concat_list(paths: Sequence[Path], target: Path) -> Path:
    """ffmpeg concat 형식 목록 파일을 paths 순서로 작성한다."""
    target.write_text("".join(_file_line(path) for path in paths), encoding="utf-8")
    return target


def video_start_seconds(path: Path, *, ffprobe: str = "ffprobe") -> float:
    """영상 파일의 첫 타임스탬프(초)를 ffprobe로 읽는다.

    값이 없으면 0이다. 읽지 못하면 MergeError를 발생시킨다.
    """
    command = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=start_time",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, timeout=PROBE_TIMEOUT_SECONDS, check=False
        )
    except FileNotFoundError as e:
        raise MergeError(f"ffprobe를 실행할 수 없다: {ffprobe}") from e
    except subprocess.TimeoutExpired as e:
        raise MergeError(f"ffprobe가 {PROBE_TIMEOUT_SECONDS:.0f}초 안에 끝나지 않았다") from e
    if completed.returncode != 0:
        raise MergeError(
            f"ffprobe 종료 코드 {completed.returncode}: {completed.stderr[-STDERR_TAIL_CHARS:]}"
        )
    value = completed.stdout.strip()
    if value in ("", "N/A"):
        return 0.0
    try:
        return float(value)
    except ValueError as e:
        raise MergeError(f"영상 첫 타임스탬프를 해석하지 못했다: {value}") from e


def write_placed_list(
    video: Sequence[Segment], target: Path, start_of: Callable[[Path], float]
) -> Path:
    """영상 구간을 시작 위치에 맞춰 이어 붙이는 concat 형식 목록 파일을 작성한다.

    start_of는 파일의 첫 타임스탬프(초)를 반환한다.
    """
    lines: list[str] = []
    for placed, length in video:
        lines.append(_file_line(placed.track))
        # concat 입력은 다음 파일을 앞 파일의 outpoint 뒤에 붙인다.
        # 앞 파일이 짧으면 빈 구간에 직전 프레임이 이어서 표시되고, 길면 outpoint에서 잘린다.
        # outpoint는 파일 안의 타임스탬프이므로,
        # 첫 타임스탬프가 0이 아닌 파일은 그만큼 더해야 남길 길이가 맞는다
        if length is not None:
            lines.append(f"outpoint {start_of(placed.track) + length:.3f}\n")
    target.write_text("".join(lines), encoding="utf-8")
    return target


def _run(command: list[str], output: Path, ffmpeg: str, timeout_seconds: float) -> None:
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


def merge_tracks(
    video: Sequence[Path],
    candidate_audio: Sequence[Path],
    interviewer_audio: Sequence[Path],
    output: Path,
    *,
    ffmpeg: str = "ffmpeg",
    timeout_seconds: float = MERGE_TIMEOUT_SECONDS,
) -> None:
    """종류마다 주어진 순서로 트랙을 이어 붙이고 합쳐 output에 mp4를 생성한다.

    영상이 여러 개이면 output과 같은 폴더에 concat 목록 파일을 작성한다.
    실패하면 MergeError를 발생시킨다.
    """
    concat_video = len(video) > 1
    video_input = (
        write_concat_list(video, output.with_name(VIDEO_LIST_FILE)) if concat_video else video[0]
    )
    command = build_merge_command(
        video_input,
        candidate_audio,
        interviewer_audio,
        output,
        concat_video=concat_video,
        ffmpeg=ffmpeg,
    )
    _run(command, output, ffmpeg, timeout_seconds)


def merge_placed_tracks(
    video: Sequence[Placed[Path]],
    candidate_audio: Sequence[Placed[Path]],
    interviewer_audio: Sequence[Placed[Path]],
    output: Path,
    *,
    ffmpeg: str = "ffmpeg",
    ffprobe: str = "ffprobe",
    timeout_seconds: float = MERGE_TIMEOUT_SECONDS,
) -> None:
    """종류마다 시작 위치 순으로 정렬해 배치한 트랙을 합쳐 output에 mp4를 생성한다.

    output과 같은 폴더에 영상 concat 목록 파일을 작성한다.
    실패하면 MergeError를 발생시킨다.
    """
    video_segments = segments(video)
    video_list = write_placed_list(
        video_segments,
        output.with_name(VIDEO_LIST_FILE),
        partial(video_start_seconds, ffprobe=ffprobe),
    )
    command = build_placed_merge_command(
        video_list,
        video_segments[0][0].offset_seconds,
        [*segments(candidate_audio), *segments(interviewer_audio)],
        output,
        ffmpeg=ffmpeg,
    )
    _run(command, output, ffmpeg, timeout_seconds)
