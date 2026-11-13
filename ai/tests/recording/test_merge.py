import json
import shutil
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.recording.merge import (
    GROUP_MERGE_TIMEOUT_SECONDS,
    MERGE_TIMEOUT_SECONDS,
    VIDEO_LIST_FILE,
    MergeError,
    MissingTrackError,
    Piece,
    Placed,
    PlacedTracks,
    Tracks,
    build_merge_command,
    build_placed_merge_command,
    build_segment_command,
    merge_group_segments,
    merge_placed_tracks,
    merge_tracks,
    pieces,
    place_tracks,
    segments,
    select_tracks,
    video_size,
    video_start_seconds,
    write_placed_list,
)
from app.recording.storage import StoredObject

RAW = "recordings/raw/55/"
# BE 트랙 자동 녹화 경로(AI 명세 7장): {참가자}-{종류}-{트랙 id}.{확장자}
VIDEO = RAW + "candidate-video-TR_VCab12.mp4"
CANDIDATE = RAW + "candidate-audio-TR_AMcd34.ogg"
INTERVIEWER = RAW + "interviewer-audio-TR_AMef56.ogg"


def stored(key: str, minute: int = 0) -> StoredObject:
    return StoredObject(key, datetime(2026, 11, 3, 10, minute, tzinfo=UTC))


def stored_all(*keys: str) -> list[StoredObject]:
    return [stored(key) for key in keys]


def test_tracks_are_found_by_name_prefix_with_track_id_and_any_extension() -> None:
    assert select_tracks(stored_all(INTERVIEWER, VIDEO, CANDIDATE), RAW) == Tracks(
        candidate_video=(VIDEO,), candidate_audio=(CANDIDATE,), interviewer_audio=(INTERVIEWER,)
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
    tracks = select_tracks(stored_all(*keys), RAW)
    assert tracks.candidate_video == (VIDEO,)
    assert tracks.candidate_audio == (CANDIDATE,)


@pytest.mark.parametrize("absent", [VIDEO, CANDIDATE, INTERVIEWER])
def test_any_missing_kind_is_track_not_found(absent: str) -> None:
    keys = [key for key in (VIDEO, CANDIDATE, INTERVIEWER) if key != absent]
    stored = stored_all(*keys)
    with pytest.raises(MissingTrackError):
        select_tracks(stored, RAW)


def test_rejoined_tracks_of_a_kind_are_ordered_by_upload_time_not_name() -> None:
    # 트랙 id는 시간 순서와 무관하므로 이름 순서와 업로드 순서를 반대로 둔다
    later_video = RAW + "candidate-video-TR_VCaa00.mp4"
    later_audio = RAW + "candidate-audio-TR_AMaa00.ogg"
    objects = [
        stored(later_video, 20),
        stored(VIDEO, 5),
        stored(INTERVIEWER, 30),
        stored(later_audio, 20),
        stored(CANDIDATE, 5),
    ]
    assert select_tracks(objects, RAW) == Tracks(
        candidate_video=(VIDEO, later_video),
        candidate_audio=(CANDIDATE, later_audio),
        interviewer_audio=(INTERVIEWER,),
    )


def test_command_copies_video_and_mixes_both_voices_into_aac() -> None:
    command = build_merge_command(Path("v.mp4"), [Path("c.ogg")], [Path("i.ogg")], Path("o.mp4"))
    joined = " ".join(command)
    assert "-c:v copy" in joined
    assert "-c:a aac" in joined
    assert "[1:a][2:a]amix=inputs=2:duration=longest:normalize=0[a]" in joined
    assert "concat" not in joined
    assert command.count("-threads") == 4
    assert command[-1] == "o.mp4"


def test_command_concatenates_each_kind_in_given_order_before_mixing() -> None:
    command = build_merge_command(
        Path("list.txt"),
        [Path("c1.ogg"), Path("c2.ogg")],
        [Path("i1.ogg"), Path("i2.ogg"), Path("i3.ogg")],
        Path("o.mp4"),
        concat_video=True,
    )
    joined = " ".join(command)
    # 영상은 다시 인코딩하지 않도록 concat 필터가 아닌 concat 형식 입력으로 읽는다
    assert "-f concat -safe 0 -i list.txt" in joined
    assert "-c:v copy" in joined
    inputs = [command[index + 1] for index, arg in enumerate(command) if arg == "-i"]
    assert inputs == ["list.txt", "c1.ogg", "c2.ogg", "i1.ogg", "i2.ogg", "i3.ogg"]
    mix = command[command.index("-filter_complex") + 1]
    assert mix == (
        "[1:a][2:a]concat=n=2:v=0:a=1[c];"
        "[3:a][4:a][5:a]concat=n=3:v=0:a=1[i];"
        "[c][i]amix=inputs=2:duration=longest:normalize=0[a]"
    )


def test_timeout_is_temporary_value() -> None:
    assert MERGE_TIMEOUT_SECONDS == 300.0


def test_missing_ffmpeg_is_merge_error(tmp_path: Path) -> None:
    with pytest.raises(MergeError):
        merge_tracks(
            [tmp_path / "v"],
            [tmp_path / "c"],
            [tmp_path / "i"],
            tmp_path / "o.mp4",
            ffmpeg=str(tmp_path / "no-ffmpeg"),
        )


def test_multiple_videos_are_listed_in_order_for_concat_input(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[list[str]] = []
    output = tmp_path / "o.mp4"

    def run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        output.write_bytes(b"mp4")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(subprocess, "run", run)
    first, second = tmp_path / "v-b.mp4", tmp_path / "it's-a.mp4"
    merge_tracks([first, second], [tmp_path / "c"], [tmp_path / "i"], output)

    listing = tmp_path / VIDEO_LIST_FILE
    assert commands[0][commands[0].index("-i") + 1] == str(listing)
    # 작은따옴표가 있는 경로도 concat 목록 형식으로 이스케이프한다
    assert listing.read_text(encoding="utf-8") == (
        f"file '{first}'\n" + f"file '{tmp_path / 'it'}" + "'\\''s-a.mp4'\n"
    )


FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


@pytest.mark.skipif(FFMPEG is None or FFPROBE is None, reason="ffmpeg가 설치되지 않았다")
def test_real_ffmpeg_merges_h264_and_two_opus_tracks(tmp_path: Path) -> None:
    assert FFMPEG is not None
    assert FFPROBE is not None
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

    merge_tracks([video], [candidate], [interviewer], output, ffmpeg=FFMPEG)

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


def synthesize(ffmpeg: str, source: str, codec: list[str], target: Path) -> Path:
    command = [ffmpeg, "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", source]
    subprocess.run([*command, *codec, str(target)], check=True)
    return target


@pytest.mark.skipif(FFMPEG is None or FFPROBE is None, reason="ffmpeg가 설치되지 않았다")
def test_real_ffmpeg_concatenates_rejoined_tracks_without_reencoding_video(
    tmp_path: Path,
) -> None:
    assert FFMPEG is not None
    assert FFPROBE is not None
    h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    opus = ["-c:a", "libopus"]
    # 재접속 전 1초, 재접속 뒤 2초 구간을 Egress 트랙 녹화와 같은 형식으로 만든다
    videos = [
        synthesize(FFMPEG, f"testsrc=duration={seconds}:size=320x240:rate=15", h264, path)
        for seconds, path in ((1, tmp_path / "v1.mp4"), (2, tmp_path / "v2.mp4"))
    ]
    candidates = [
        synthesize(FFMPEG, f"sine=frequency=440:duration={seconds}", opus, path)
        for seconds, path in ((1, tmp_path / "c1.ogg"), (2, tmp_path / "c2.ogg"))
    ]
    # 면접관 음성을 더 짧게 두어 음성 길이가 지원자 음성 두 구간의 합으로 정해지게 한다
    interviewer = synthesize(FFMPEG, "sine=frequency=660:duration=2", opus, tmp_path / "i.ogg")
    output = tmp_path / "merged.mp4"

    merge_tracks(videos, candidates, [interviewer], output, ffmpeg=FFMPEG)

    probe = subprocess.run(
        [FFPROBE, "-v", "error", "-show_streams", "-of", "json", str(output)],
        capture_output=True,
        text=True,
        check=True,
    )
    streams = {stream["codec_type"]: stream for stream in json.loads(probe.stdout)["streams"]}
    assert streams["video"]["codec_name"] == "h264"
    assert streams["audio"]["codec_name"] == "aac"
    # 영상·지원자 음성 모두 두 구간(1초 + 2초)이 이어 붙는다
    assert float(streams["video"]["duration"]) == pytest.approx(3.0, abs=0.15)
    assert float(streams["audio"]["duration"]) == pytest.approx(3.0, abs=0.15)


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg가 설치되지 않았다")
def test_real_ffmpeg_failure_is_merge_error(tmp_path: Path) -> None:
    assert FFMPEG is not None
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not a video")
    with pytest.raises(MergeError):
        merge_tracks([broken], [broken], [broken], tmp_path / "o.mp4", ffmpeg=FFMPEG)


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
        merge_tracks([tmp_path / "v"], [tmp_path / "c"], [tmp_path / "i"], tmp_path / "o.mp4")


def test_nonzero_exit_or_empty_output_is_merge_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "o.mp4"
    monkeypatch.setattr(subprocess, "run", fake_run(subprocess.CompletedProcess([], 1, "", "bad")))
    with pytest.raises(MergeError, match="bad"):
        merge_tracks([tmp_path / "v"], [tmp_path / "c"], [tmp_path / "i"], output)
    output.write_bytes(b"")
    monkeypatch.setattr(subprocess, "run", fake_run(subprocess.CompletedProcess([], 0, "", "")))
    with pytest.raises(MergeError):
        merge_tracks([tmp_path / "v"], [tmp_path / "c"], [tmp_path / "i"], output)


START = datetime(2026, 11, 3, 14, 0, 5, 123000, tzinfo=UTC)


def at(second: float) -> datetime:
    return START + timedelta(seconds=second)


def test_tracks_are_placed_from_earliest_start_in_start_order_not_name() -> None:
    rejoined_video = RAW + "candidate-video-TR_VCaa00.mp4"
    started = [
        (rejoined_video, at(12)),
        (VIDEO, at(2.5)),
        (CANDIDATE, at(2)),
        (INTERVIEWER, at(0)),
        (RAW + "manifest.json", at(-5)),
    ]
    assert place_tracks(started, RAW) == PlacedTracks(
        candidate_video=(Placed(VIDEO, 2.5), Placed(rejoined_video, 12.0)),
        candidate_audio=(Placed(CANDIDATE, 2.0),),
        interviewer_audio=(Placed(INTERVIEWER, 0.0),),
        origin=at(0),
    )


def test_placed_tracks_missing_a_kind_are_track_not_found() -> None:
    tracks = [(VIDEO, at(0)), (CANDIDATE, at(0))]
    with pytest.raises(MissingTrackError):
        place_tracks(tracks, RAW)


def test_segments_end_where_next_track_of_kind_starts() -> None:
    first, gap, overlap, last = (
        Placed(Path("a"), 0.0),
        Placed(Path("b"), 3.0),
        Placed(Path("c"), 4.5),
        Placed(Path("d"), 4.5),
    )
    # 같은 시각에 시작한 앞 트랙(c)은 남길 구간이 없으므로 제외한다
    assert segments([first, gap, overlap, last]) == [(first, 3.0), (gap, 1.5), (last, None)]


def test_placed_list_keeps_gap_with_outpoint_of_previous_video(tmp_path: Path) -> None:
    first, second = Placed(tmp_path / "v1.mp4", 2.0), Placed(tmp_path / "v2.mp4", 12.0)
    listing = write_placed_list(
        [(first, 10.0), (second, None)], tmp_path / "list.txt", lambda _path: 0.0
    )
    assert listing.read_text(encoding="utf-8") == (
        f"file '{first.track}'\noutpoint 10.000\nfile '{second.track}'\n"
    )


def test_placed_list_outpoint_adds_first_timestamp_of_file(tmp_path: Path) -> None:
    """outpoint는 파일 안의 타임스탬프이므로 첫 타임스탬프가 0이 아니면 그만큼 더한다."""
    first, second = Placed(tmp_path / "v1.mp4", 0.0), Placed(tmp_path / "v2.mp4", 10.0)
    listing = write_placed_list(
        [(first, 10.0), (second, None)], tmp_path / "list.txt", lambda _path: 0.5
    )
    assert "outpoint 10.500\n" in listing.read_text(encoding="utf-8")


def test_missing_ffprobe_is_merge_error(tmp_path: Path) -> None:
    with pytest.raises(MergeError, match="ffprobe"):
        video_start_seconds(tmp_path / "v.mp4", ffprobe=str(tmp_path / "no-ffprobe"))


def test_placed_command_delays_video_and_places_each_voice_segment() -> None:
    audio = [
        (Placed(Path("c1.ogg"), 2.0), 10.0),
        (Placed(Path("c2.ogg"), 12.0), None),
        (Placed(Path("i.ogg"), 0.0), None),
    ]
    command = build_placed_merge_command(Path("list.txt"), 2.0, audio, Path("o.mp4"))
    joined = " ".join(command)
    # 영상은 다시 인코딩하지 않고 첫 영상 시작 위치만큼 타임스탬프를 미룬다
    assert "-itsoffset 2.000 -f concat -safe 0 -i list.txt" in joined
    assert "-c:v copy" in joined
    inputs = [command[index + 1] for index, arg in enumerate(command) if arg == "-i"]
    assert inputs == ["list.txt", "c1.ogg", "c2.ogg", "i.ogg"]
    assert command[command.index("-filter_complex") + 1] == (
        "[1:a]asetpts=PTS-STARTPTS,atrim=end=10.000,adelay=delays=2000:all=1[a1];"
        "[2:a]asetpts=PTS-STARTPTS,adelay=delays=12000:all=1[a2];"
        "[3:a]asetpts=PTS-STARTPTS,adelay=delays=0:all=1[a3];"
        "[a1][a2][a3]amix=inputs=3:duration=longest:normalize=0[a]"
    )
    assert command[-1] == "o.mp4"


def probe(ffprobe: str, path: Path) -> dict[str, dict[str, str]]:
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_streams", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return {stream["codec_type"]: stream for stream in json.loads(result.stdout)["streams"]}


def silences(ffmpeg: str, path: Path) -> list[tuple[float, float]]:
    """음성에서 -50dB 아래로 0.5초 이상 이어진 구간(시작, 끝)이다."""
    result = subprocess.run(
        [
            ffmpeg,
            "-nostdin",
            "-i",
            str(path),
            "-af",
            "silencedetect=n=-50dB:d=0.5",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    starts = [
        float(line.split("silence_start: ")[1])
        for line in result.stderr.splitlines()
        if "silence_start: " in line
    ]
    ends = [
        float(line.split("silence_end: ")[1].split()[0])
        for line in result.stderr.splitlines()
        if "silence_end: " in line
    ]
    return list(zip(starts, ends, strict=True))


# WebRTC H.264는 B 프레임이 없는 Constrained Baseline 프로필로 송출되므로 같은 조건으로 만든다
WEBRTC_H264 = ["-c:v", "libx264", "-profile:v", "baseline", "-pix_fmt", "yuv420p"]
OPUS = ["-c:a", "libopus"]


@pytest.mark.skipif(FFMPEG is None or FFPROBE is None, reason="ffmpeg가 설치되지 않았다")
def test_real_ffmpeg_places_late_start_and_rejoin_gap(tmp_path: Path) -> None:
    assert FFMPEG is not None
    assert FFPROBE is not None
    # 면접관 음성은 0~1초, 지원자는 2초에 시작해 1초 녹화 뒤 끊기고 4초에 재접속해 1초 녹화한다
    interviewer = synthesize(FFMPEG, "sine=frequency=660:duration=1", OPUS, tmp_path / "i.ogg")
    videos, candidates = [], []
    for index, offset in enumerate((2.0, 4.0)):
        source = "testsrc=duration=1:size=320x240:rate=15"
        video = synthesize(FFMPEG, source, WEBRTC_H264, tmp_path / f"v{index}.mp4")
        audio = synthesize(
            FFMPEG, "sine=frequency=440:duration=1", OPUS, tmp_path / f"c{index}.ogg"
        )
        videos.append(Placed(video, offset))
        candidates.append(Placed(audio, offset))
    output = tmp_path / "merged.mp4"

    merge_placed_tracks(videos, candidates, [Placed(interviewer, 0.0)], output, ffmpeg=FFMPEG)

    streams = probe(FFPROBE, output)
    assert streams["video"]["codec_name"] == "h264"
    # 영상은 2초 위치에서 시작해 재접속 공백(3~4초)을 지나 5초에 끝난다
    assert float(streams["video"]["start_time"]) == pytest.approx(2.0, abs=0.1)
    video_end = float(streams["video"]["start_time"]) + float(streams["video"]["duration"])
    assert video_end == pytest.approx(5.0, abs=0.15)
    assert float(streams["audio"]["duration"]) == pytest.approx(5.0, abs=0.15)
    # 지원자 음성은 2초와 4초에 시작하고, 그 앞 구간은 무음이다
    found = silences(FFMPEG, output)
    assert len(found) == 2
    for (start, end), expected in zip(found, ((1.0, 2.0), (3.0, 4.0)), strict=True):
        assert start == pytest.approx(expected[0], abs=0.1)
        assert end == pytest.approx(expected[1], abs=0.1)


@pytest.mark.skipif(FFMPEG is None or FFPROBE is None, reason="ffmpeg가 설치되지 않았다")
def test_real_ffmpeg_cuts_previous_track_where_overlapping_track_starts(tmp_path: Path) -> None:
    assert FFMPEG is not None
    assert FFPROBE is not None
    # 앞 구간(0~3초)이 끝나기 전에 뒤 구간(1~2초)이 시작한다
    videos, candidates = [], []
    for index, (offset, seconds) in enumerate(((0.0, 3), (1.0, 1))):
        source = f"testsrc=duration={seconds}:size=320x240:rate=15"
        video = synthesize(FFMPEG, source, WEBRTC_H264, tmp_path / f"v{index}.mp4")
        tone = f"sine=frequency=440:duration={seconds}"
        audio = synthesize(FFMPEG, tone, OPUS, tmp_path / f"c{index}.ogg")
        videos.append(Placed(video, offset))
        candidates.append(Placed(audio, offset))
    interviewer = synthesize(FFMPEG, "sine=frequency=660:duration=1", OPUS, tmp_path / "i.ogg")
    output = tmp_path / "merged.mp4"

    merge_placed_tracks(videos, candidates, [Placed(interviewer, 0.0)], output, ffmpeg=FFMPEG)

    streams = probe(FFPROBE, output)
    # 앞 구간을 뒤 구간이 시작하는 1초에서 자르므로 뒤 구간이 끝나는 2초에 끝난다
    assert float(streams["video"]["duration"]) == pytest.approx(2.0, abs=0.15)
    assert float(streams["audio"]["duration"]) == pytest.approx(2.0, abs=0.15)


@pytest.mark.skipif(FFMPEG is None or FFPROBE is None, reason="ffmpeg가 설치되지 않았다")
def test_real_ffmpeg_cuts_video_with_nonzero_first_timestamp_at_placed_length(
    tmp_path: Path,
) -> None:
    """첫 타임스탬프가 0.5초인 영상도 다음 영상이 시작하는 위치까지 1초를 남긴다."""
    assert FFMPEG is not None
    assert FFPROBE is not None
    # 앞 영상(2초, 첫 타임스탬프 0.5초)은 0초에, 뒤 영상(1초)은 1초에 배치한다
    shifted = [*WEBRTC_H264, "-output_ts_offset", "0.5"]
    source = "testsrc=duration=2:size=320x240:rate=15"
    first = synthesize(FFMPEG, source, shifted, tmp_path / "v0.mp4")
    assert video_start_seconds(first, ffprobe=FFPROBE) == pytest.approx(0.5, abs=0.01)
    second_source = "testsrc=duration=1:size=320x240:rate=15"
    second = synthesize(FFMPEG, second_source, WEBRTC_H264, tmp_path / "v1.mp4")
    tone = synthesize(FFMPEG, "sine=frequency=440:duration=2", OPUS, tmp_path / "c.ogg")
    output = tmp_path / "merged.mp4"

    merge_placed_tracks(
        [Placed(first, 0.0), Placed(second, 1.0)],
        [Placed(tone, 0.0)],
        [Placed(tone, 0.0)],
        output,
        ffmpeg=FFMPEG,
        ffprobe=FFPROBE,
    )

    video = probe(FFPROBE, output)["video"]
    # 앞 영상 1초(15프레임)와 뒤 영상 1초(15프레임)가 이어진다
    assert int(video["nb_frames"]) == 30
    assert float(video["duration"]) == pytest.approx(2.0, abs=0.1)


# 그룹 면접(AI 명세 7장): 본인 답변 구간만 잘라 이어 붙인다


def test_pieces_follow_reconnected_tracks_within_span() -> None:
    # 0초에 시작한 트랙이 끊기고 50초에 재접속했다
    tracks = [Placed(Path("a.mp4"), 0.0), Placed(Path("b.mp4"), 50.0)]

    assert pieces(tracks, 40.0, 60.0) == [
        Piece(Path("a.mp4"), 40.0, 10.0, 0.0),
        Piece(Path("b.mp4"), 0.0, 10.0, 10.0),
    ]


def test_pieces_start_inside_span_when_track_starts_late() -> None:
    assert pieces([Placed(Path("a.mp4"), 3.0)], 1.0, 5.0) == [Piece(Path("a.mp4"), 0.0, 2.0, 2.0)]


def test_pieces_are_empty_when_track_starts_after_span() -> None:
    assert pieces([Placed(Path("a.mp4"), 10.0)], 1.0, 5.0) == []


def test_segment_command_seeks_each_piece_and_places_it_in_span() -> None:
    command = build_segment_command(
        [Piece(Path("v.mp4"), 40.0, 10.0, 0.0), Piece(Path("w.mp4"), 0.0, 10.0, 10.0)],
        [Piece(Path("c.ogg"), 40.0, 20.0, 0.0), Piece(Path("i.ogg"), 1.5, 18.0, 2.0)],
        20.0,
        (640, 480),
        Path("s.mp4"),
        Path("s.wav"),
    )

    inputs = [command[i + 1 : i + 6 : 2] for i, arg in enumerate(command) if arg == "-ss"]
    assert inputs == [
        ["40.000", "10.000", "v.mp4"],
        ["0.000", "10.000", "w.mp4"],
        ["40.000", "20.000", "c.ogg"],
        ["1.500", "18.000", "i.ogg"],
    ]
    assert command[command.index("-filter_complex") + 1] == (
        "color=c=black:s=640x480:r=30:d=20.000[v0];"
        "[0:v]setpts=PTS-STARTPTS+0.000/TB,scale=640:480,setsar=1[p0];"
        "[v0][p0]overlay=eof_action=repeat[v1];"
        "[1:v]setpts=PTS-STARTPTS+10.000/TB,scale=640:480,setsar=1[p1];"
        "[v1][p1]overlay=eof_action=repeat[v2];"
        "[2:a]asetpts=PTS-STARTPTS,adelay=delays=0:all=1[a0];"
        "[3:a]asetpts=PTS-STARTPTS,adelay=delays=2000:all=1[a1];"
        "anullsrc=r=48000:cl=stereo,atrim=end=20.000[silence];"
        "[silence][a0][a1]amix=inputs=3:duration=first:normalize=0[a]"
    )
    outputs = command[command.index("-filter_complex") + 2 :]
    # 영상과 음성을 따로 저장해 음성은 이어 붙인 뒤 AAC로 한 번만 인코딩한다
    assert outputs[:2] == ["-map", "[v2]"]
    assert outputs[outputs.index("s.mp4") - 2 : outputs.index("s.mp4") + 1] == [
        "-t",
        "20.000",
        "s.mp4",
    ]
    assert outputs[outputs.index("s.mp4") + 1 :] == [
        "-map",
        "[a]",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "48000",
        "-t",
        "20.000",
        "s.wav",
    ]


def test_odd_video_size_is_rounded_down_to_even(monkeypatch: pytest.MonkeyPatch) -> None:
    """H.264 yuv420p는 짝수 크기만 인코딩한다."""
    result = subprocess.CompletedProcess([], 0, "641,481\n", "")
    monkeypatch.setattr(subprocess, "run", fake_run(result))
    assert video_size(Path("v.mp4")) == (640, 480)


def test_group_timeout_is_contract_value() -> None:
    assert GROUP_MERGE_TIMEOUT_SECONDS == 600.0


def test_group_merge_stops_when_segments_use_up_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """상한은 ffmpeg 실행마다가 아니라 그룹 작업 하나 전체에 적용한다."""
    timeouts: list[object] = []
    now = [0.0]

    def run(command: list[str], **kwargs: object) -> object:
        if command[0] == "ffprobe":
            return subprocess.CompletedProcess(command, 0, "640,480\n", "")
        timeouts.append(kwargs["timeout"])
        for arg in command:
            if arg.endswith((".mp4", ".wav")):
                Path(arg).write_bytes(b"x")
        now[0] += 400.0
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(subprocess, "run", run)
    track = [Placed(tmp_path / "t", 0.0)]

    with pytest.raises(MergeError, match="600초"):
        merge_group_segments(
            track, track, track, [(0.0, 1.0), (2.0, 3.0)], tmp_path / "o.mp4", clock=lambda: now[0]
        )
    assert timeouts == [600.0, 200.0]


def lumas(ffmpeg: str, path: Path) -> list[tuple[float, float]]:
    """영상 프레임마다 (표시 시각, 평균 밝기)다."""
    result = subprocess.run(
        [
            ffmpeg,
            "-nostdin",
            "-i",
            str(path),
            "-vf",
            "signalstats,metadata=mode=print",
            "-an",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    times = [
        float(line.split("pts_time:")[1].split()[0])
        for line in result.stderr.splitlines()
        if "pts_time:" in line
    ]
    values = [
        float(line.split("lavfi.signalstats.YAVG=")[1])
        for line in result.stderr.splitlines()
        if "lavfi.signalstats.YAVG=" in line
    ]
    return list(zip(times, values, strict=True))


def pcm(ffmpeg: str, path: Path) -> list[float]:
    """음성을 타임스탬프와 관계없이 디코딩한 순서대로 48kHz 모노 샘플로 반환한다."""
    result = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    )
    return list(memoryview(result.stdout).cast("f"))


def loudness_edges(samples: list[float]) -> list[float]:
    """10ms 단위로 소리가 있고 없음이 바뀌는 위치(초)다. 위치는 샘플 순서로 계산한다."""
    block = 480
    loud = [
        max(abs(x) for x in samples[i : i + block]) > 0.01
        for i in range(0, len(samples) - block + 1, block)
    ]
    return [index / 100 for index in range(1, len(loud)) if loud[index] != loud[index - 1]]


@pytest.mark.skipif(FFMPEG is None or FFPROBE is None, reason="ffmpeg가 설치되지 않았다")
def test_real_ffmpeg_cuts_group_answer_segments_at_exact_positions(tmp_path: Path) -> None:
    assert FFMPEG is not None
    assert FFPROBE is not None
    # 지원자 영상은 파일 안 t초의 밝기가 20 + 20t인 10초 영상이다.
    # 키프레임을 처음 하나만 생성해 구간 시작 위치를 키프레임이 아닌 곳에서 찾게 한다
    brightness = "nullsrc=s=320x240:r=30:d=10,geq=lum='20+20*T':cb=128:cr=128"
    video = synthesize(FFMPEG, brightness, [*WEBRTC_H264, "-g", "1000"], tmp_path / "v.mp4")
    candidate = synthesize(FFMPEG, "sine=frequency=440:duration=10", OPUS, tmp_path / "c.ogg")
    interviewer = synthesize(FFMPEG, "sine=frequency=660:duration=2", OPUS, tmp_path / "i.ogg")
    output = tmp_path / "merged.mp4"

    # 면접관 음성은 0~2초, 지원자 트랙은 3~13초에 녹화되었다
    merge_group_segments(
        [Placed(video, 3.0)],
        [Placed(candidate, 3.0)],
        [Placed(interviewer, 0.0)],
        [(1.0, 5.0), (8.0, 10.5), (12.0, 14.0)],
        output,
        ffmpeg=FFMPEG,
        ffprobe=FFPROBE,
    )

    streams = probe(FFPROBE, output)
    # 구간 길이(4 + 2.5 + 2초)를 더한 길이다
    assert float(streams["video"]["duration"]) == pytest.approx(8.5, abs=0.01)
    assert float(streams["audio"]["duration"]) == pytest.approx(8.5, abs=0.01)
    frames = dict(lumas(FFMPEG, output))
    expected = {
        0.0: 16.0,  # 첫 구간 1초: 지원자 영상 시작 전이라 검은 화면이다
        2.0: 20.0,  # 3초: 지원자 영상 첫 화면
        3.9: 58.0,  # 4.9초
        4.0: 120.0,  # 둘째 구간 8초: 파일 안 5초
        6.4: 168.0,  # 10.4초
        6.5: 200.0,  # 셋째 구간 12초: 파일 안 9초
        8.4: 220.0,  # 13.9초: 영상이 13초에 끝나 마지막 화면을 유지한다
    }
    for second, luma in expected.items():
        nearest = min(frames, key=lambda t: abs(t - second))
        assert abs(nearest - second) < 0.02
        assert frames[nearest] == pytest.approx(luma, abs=4), second
    # 다른 구간의 음성이 섞이지 않는다: 면접관이 끝난 2초부터 지원자가 시작한 3초까지,
    # 지원자 녹화가 끝난 13초부터 14초까지만 무음이다
    found = silences(FFMPEG, output)
    assert len(found) == 2
    for (start, end), (want_start, want_end) in zip(found, ((1.0, 2.0), (7.5, 8.5)), strict=True):
        assert start == pytest.approx(want_start, abs=0.05)
        assert end == pytest.approx(want_end, abs=0.05)
    # 브라우저처럼 샘플을 차례로 재생해도 구간 경계(4초, 6.5초) 뒤 음성이 늦어지지 않는다
    assert loudness_edges(pcm(FFMPEG, output)) == pytest.approx([1.0, 2.0, 7.5], abs=0.02)
