import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.recording.merge import (
    MERGE_TIMEOUT_SECONDS,
    MergeError,
    MissingTrackError,
    MultipleTracksError,
    Tracks,
    build_merge_command,
    merge_tracks,
    select_tracks,
)

RAW = "recordings/raw/55/"
# BE 트랙 자동 녹화 경로(AI 명세 7장): {참가자}-{종류}-{트랙 id}.{확장자}
VIDEO = RAW + "candidate-video-TR_VCab12.mp4"
CANDIDATE = RAW + "candidate-audio-TR_AMcd34.ogg"
INTERVIEWER = RAW + "interviewer-audio-TR_AMef56.ogg"


def test_tracks_are_found_by_name_prefix_with_track_id_and_any_extension() -> None:
    assert select_tracks([INTERVIEWER, VIDEO, CANDIDATE], RAW) == Tracks(
        candidate_video=VIDEO, candidate_audio=CANDIDATE, interviewer_audio=INTERVIEWER
    )


def test_files_outside_raw_prefix_or_in_subfolders_are_ignored() -> None:
    keys = [
        VIDEO,
        CANDIDATE,
        INTERVIEWER,
        "recordings/raw/551/candidate-video-TR_x.mp4",
        RAW + "old/candidate-audio-TR_y.ogg",
        # 원본 위치 바로 아래가 아닌 파일은 앞부분이 같아도 트랙이 아니다
        RAW + "candidate-audio-dir/TR_y.ogg",
        "candidate-video-TR_z.mp4",
        RAW + "manifest.json",
    ]
    assert select_tracks(keys, RAW).candidate_video == VIDEO


@pytest.mark.parametrize("absent", [VIDEO, CANDIDATE, INTERVIEWER])
def test_any_missing_kind_is_track_not_found(absent: str) -> None:
    keys = [key for key in (VIDEO, CANDIDATE, INTERVIEWER) if key != absent]
    with pytest.raises(MissingTrackError):
        select_tracks(keys, RAW)


def test_rejoined_candidate_tracks_are_not_concatenated_in_guessed_order() -> None:
    with pytest.raises(MultipleTracksError):
        select_tracks([VIDEO, RAW + "candidate-video-TR_VCzz99.mp4", CANDIDATE, INTERVIEWER], RAW)


def test_command_copies_video_and_mixes_both_voices_into_aac() -> None:
    command = build_merge_command(Path("v.mp4"), Path("c.ogg"), Path("i.ogg"), Path("o.mp4"))
    joined = " ".join(command)
    assert "-c:v copy" in joined
    assert "-c:a aac" in joined
    assert "amix=inputs=2:duration=longest:normalize=0" in joined
    assert command.count("-threads") == 4
    assert command[-1] == "o.mp4"


def test_timeout_is_temporary_value() -> None:
    assert MERGE_TIMEOUT_SECONDS == 300.0


def test_missing_ffmpeg_is_merge_error(tmp_path: Path) -> None:
    with pytest.raises(MergeError):
        merge_tracks(
            tmp_path / "v",
            tmp_path / "c",
            tmp_path / "i",
            tmp_path / "o.mp4",
            ffmpeg=str(tmp_path / "no-ffmpeg"),
        )


FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


@pytest.mark.skipif(FFMPEG is None or FFPROBE is None, reason="ffmpeg가 설치되지 않았다")
def test_real_ffmpeg_merges_h264_and_two_opus_tracks(tmp_path: Path) -> None:
    assert FFMPEG is not None and FFPROBE is not None
    video, candidate, interviewer = tmp_path / "v.mp4", tmp_path / "c.ogg", tmp_path / "i.ogg"
    # Egress 트랙 녹화와 같은 형식(H.264 mp4, Opus ogg)의 짧은 합성 파일을 만든다
    for args in (
        [
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=2:size=320x240:rate=15",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(video),
        ],
        ["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libopus", str(candidate)],
        ["-f", "lavfi", "-i", "sine=frequency=660:duration=3", "-c:a", "libopus", str(interviewer)],
    ):
        subprocess.run([FFMPEG, "-nostdin", "-loglevel", "error", "-y", *args], check=True)
    output = tmp_path / "merged.mp4"

    merge_tracks(video, candidate, interviewer, output, ffmpeg=FFMPEG)

    probe = subprocess.run(
        [FFPROBE, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)],
        capture_output=True,
        text=True,
        check=True,
    )
    info = json.loads(probe.stdout)
    codecs = sorted(stream["codec_name"] for stream in info["streams"])
    assert codecs == ["aac", "h264"]
    # 더 긴 면접관 음성(3초)까지 남는다
    assert float(info["format"]["duration"]) >= 2.9


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg가 설치되지 않았다")
def test_real_ffmpeg_failure_is_merge_error(tmp_path: Path) -> None:
    assert FFMPEG is not None
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not a video")
    with pytest.raises(MergeError):
        merge_tracks(broken, broken, broken, tmp_path / "o.mp4", ffmpeg=FFMPEG)


def fake_run(result: object) -> object:
    def run(command: list[str], **kwargs: object) -> object:
        if isinstance(result, BaseException):
            raise result
        return result

    return run


def test_timeout_stops_ffmpeg_as_merge_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(subprocess, "run", fake_run(subprocess.TimeoutExpired("ffmpeg", 300)))
    with pytest.raises(MergeError, match="300초"):
        merge_tracks(tmp_path / "v", tmp_path / "c", tmp_path / "i", tmp_path / "o.mp4")


def test_nonzero_exit_or_empty_output_is_merge_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "o.mp4"
    monkeypatch.setattr(subprocess, "run", fake_run(subprocess.CompletedProcess([], 1, "", "bad")))
    with pytest.raises(MergeError, match="bad"):
        merge_tracks(tmp_path / "v", tmp_path / "c", tmp_path / "i", output)
    output.write_bytes(b"")
    monkeypatch.setattr(subprocess, "run", fake_run(subprocess.CompletedProcess([], 0, "", "")))
    with pytest.raises(MergeError):
        merge_tracks(tmp_path / "v", tmp_path / "c", tmp_path / "i", output)
