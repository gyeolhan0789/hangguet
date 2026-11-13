import shutil
import subprocess
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from app.common.results import ResultPublishError
from app.recording.job import (
    TRACK_POLL_SECONDS,
    TRACK_SETTLE_SECONDS,
    TRACK_WAIT_SECONDS,
    RecordingMerger,
)
from app.recording.merge import MergeError
from app.recording.storage import StorageError, StoredObject
from app.worker.messages import GroupRecording, MergeRecordingJob, RecordingSegment

RAW = "recordings/raw/55/"
VIDEO = RAW + "candidate-video-TR_V1.mp4"
CANDIDATE = RAW + "candidate-audio-TR_A1.ogg"
INTERVIEWER = RAW + "interviewer-audio-TR_A2.ogg"
ALL = [VIDEO, CANDIDATE, INTERVIEWER]
# 재접속 뒤 다시 올린 트랙. 트랙 id는 시간 순서와 무관하므로 이름이 앞서게 둔다
REJOINED_VIDEO = RAW + "candidate-video-TR_V0.mp4"
REJOINED_CANDIDATE = RAW + "candidate-audio-TR_A0.ogg"
# 저장소 저장 시각(분). 재접속 뒤 트랙은 면접이 끝난 뒤 업로드된다
UPLOADED_MINUTE = {REJOINED_VIDEO: 30, REJOINED_CANDIDATE: 30, INTERVIEWER: 30}
JOB = MergeRecordingJob(
    job_id="8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34",
    session_id=55,
    requested_at=datetime(2026, 10, 27, tzinfo=UTC),
    raw_prefix=RAW,
    object_key="recordings/55.mp4",
)


class FakeStorage:
    """목록 조회마다 다음 목록을 반환하고, 마지막 목록은 계속 반환한다."""

    def __init__(self, *listings: list[str], source: Path | None = None, prefix: str = RAW) -> None:
        self.listings = list(listings)
        self.prefix = prefix
        self.listed = 0
        self.source = source
        self.downloaded: list[tuple[str, Path]] = []
        self.uploaded: list[tuple[str, str]] = []
        self.fail_on: str | None = None

    def list(self, prefix: str) -> list[StoredObject]:
        assert prefix == self.prefix
        if self.fail_on == "list":
            raise StorageError("목록 조회 실패")
        listing = self.listings[min(self.listed, len(self.listings) - 1)]
        self.listed += 1
        return [
            StoredObject(key, datetime(2026, 10, 27, 10, UPLOADED_MINUTE.get(key, 10), tzinfo=UTC))
            for key in listing
        ]

    def download(self, key: str, path: Path) -> None:
        self.downloaded.append((key, path))
        if self.source is not None:
            shutil.copy(self.source / Path(key).name, path)
        else:
            path.write_bytes(b"track")

    def upload(self, path: Path, key: str) -> None:
        if self.fail_on == "upload":
            raise StorageError("업로드 실패")
        self.uploaded.append((path.name, key))


class FakeResults:
    def __init__(self, error: Exception | None = None) -> None:
        self.published: list[tuple[str, dict[str, Any]]] = []
        self.error = error

    def publish_job_result(self, job: Any, result_type: Any, fields: dict[str, Any]) -> None:
        assert job.job_id == JOB.job_id
        if self.error is not None:
            raise self.error
        self.published.append((result_type.value, dict(fields)))


class FakeTime:
    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def fake_merge(
    video: Sequence[Path], candidate: Sequence[Path], interviewer: Sequence[Path], output: Path
) -> None:
    output.write_bytes(b"mp4")


def names(paths: Sequence[Path]) -> tuple[str, ...]:
    return tuple(path.name for path in paths)


def recording_merge(merged: list[tuple[tuple[str, ...], ...]]) -> Any:
    def merge(
        video: Sequence[Path], candidate: Sequence[Path], interviewer: Sequence[Path], output: Path
    ) -> None:
        merged.append((names(video), names(candidate), names(interviewer), (output.name,)))
        fake_merge(video, candidate, interviewer, output)

    return merge


def merger(
    storage: FakeStorage,
    results: FakeResults,
    tmp_path: Path,
    *,
    merge: Any = fake_merge,
    merge_placed: Any = fake_merge,
    merge_group: Any = None,
    clock: FakeTime | None = None,
    track_starts: Any = None,
) -> RecordingMerger:
    time = clock or FakeTime()
    return RecordingMerger(
        lambda: storage,
        results,  # type: ignore[arg-type]
        track_starts=track_starts or (lambda _room: None),
        merge=merge,
        merge_placed=merge_placed,
        merge_group=merge_group or (lambda *kinds: kinds[-1].write_bytes(b"mp4")),
        sleep=time.sleep,
        clock=lambda: time.now,
        work_root=tmp_path,
    )


def test_tracks_are_merged_and_uploaded_to_object_key(tmp_path: Path) -> None:
    storage, results = FakeStorage(ALL), FakeResults()
    merged: list[tuple[tuple[str, ...], ...]] = []

    merger(storage, results, tmp_path, merge=recording_merge(merged))(JOB)

    assert [key for key, _ in storage.downloaded] == ALL
    # ffmpeg가 형식을 알 수 있도록 원래 파일 이름(확장자)을 유지한다
    assert merged == [
        (
            ("candidate-video-TR_V1.mp4",),
            ("candidate-audio-TR_A1.ogg",),
            ("interviewer-audio-TR_A2.ogg",),
            ("merged.mp4",),
        )
    ]
    assert storage.uploaded == [("merged.mp4", "recordings/55.mp4")]
    assert results.published == [
        ("recording.merged", {"objectKey": "recordings/55.mp4", "recordingStartedAt": None})
    ]
    # 임시 폴더는 처리 뒤 삭제한다
    assert list(tmp_path.iterdir()) == []


def test_waits_until_tracks_still_uploading_appear(tmp_path: Path) -> None:
    clock = FakeTime()
    storage, results = FakeStorage([VIDEO], [VIDEO, CANDIDATE], ALL), FakeResults()
    merger(storage, results, tmp_path, clock=clock)(JOB)
    # 세 종류가 보인 시각(10초)부터 목록이 변하지 않는 시간을 더 기다린다
    assert clock.now == 2 * TRACK_POLL_SECONDS + TRACK_SETTLE_SECONDS
    assert results.published[0][0] == "recording.merged"


def test_tracks_already_present_still_wait_for_settle_time(tmp_path: Path) -> None:
    clock = FakeTime()
    merger(FakeStorage(ALL), FakeResults(), tmp_path, clock=clock)(JOB)
    assert clock.now == TRACK_SETTLE_SECONDS


def test_rejoined_tracks_of_a_kind_are_merged_in_upload_order(tmp_path: Path) -> None:
    storage = FakeStorage([*ALL, REJOINED_VIDEO, REJOINED_CANDIDATE])
    results = FakeResults()
    merged: list[tuple[tuple[str, ...], ...]] = []

    merger(storage, results, tmp_path, merge=recording_merge(merged))(JOB)

    assert merged == [
        (
            ("candidate-video-TR_V1.mp4", "candidate-video-TR_V0.mp4"),
            ("candidate-audio-TR_A1.ogg", "candidate-audio-TR_A0.ogg"),
            ("interviewer-audio-TR_A2.ogg",),
            ("merged.mp4",),
        )
    ]
    assert results.published == [
        ("recording.merged", {"objectKey": "recordings/55.mp4", "recordingStartedAt": None})
    ]


def test_track_uploaded_late_after_rejoin_is_included(tmp_path: Path) -> None:
    clock = FakeTime()
    # 재접속 전 트랙으로 세 종류가 먼저 보이고, 재접속 뒤 영상은 세 번째 다시 조회(15초)에서 보인다
    storage = FakeStorage(ALL, ALL, ALL, [*ALL, REJOINED_VIDEO])
    merged: list[tuple[tuple[str, ...], ...]] = []

    merger(storage, FakeResults(), tmp_path, merge=recording_merge(merged), clock=clock)(JOB)

    assert merged[0][0] == ("candidate-video-TR_V1.mp4", "candidate-video-TR_V0.mp4")
    # 목록이 변한 시각부터 다시 변하지 않는 시간을 기다린다
    assert clock.now == 3 * TRACK_POLL_SECONDS + TRACK_SETTLE_SECONDS


def test_tracks_that_keep_changing_are_merged_at_settle_limit(tmp_path: Path) -> None:
    clock = FakeTime()
    polls = int((TRACK_WAIT_SECONDS + TRACK_SETTLE_SECONDS) / TRACK_POLL_SECONDS) + 2
    # 조회할 때마다 영상이 하나씩 늘어 목록이 계속 변한다
    listings = [
        [*ALL, *(RAW + f"candidate-video-TR_X{index}.mp4" for index in range(count))]
        for count in range(polls)
    ]
    storage = FakeStorage(*listings)

    merger(storage, FakeResults(), tmp_path, clock=clock)(JOB)

    assert clock.now == TRACK_WAIT_SECONDS + TRACK_SETTLE_SECONDS
    assert storage.listed == int(clock.now / TRACK_POLL_SECONDS) + 1


def test_track_not_found_after_waiting_limit(tmp_path: Path) -> None:
    clock = FakeTime()
    storage, results = FakeStorage([VIDEO, CANDIDATE]), FakeResults()
    merger(storage, results, tmp_path, clock=clock)(JOB)
    assert results.published == [("recording.mergeFailed", {"reason": "TRACK_NOT_FOUND"})]
    # 마지막 조회는 대기 상한 시각에 한다
    assert clock.now == TRACK_WAIT_SECONDS
    assert storage.listed == int(TRACK_WAIT_SECONDS / TRACK_POLL_SECONDS) + 1
    assert storage.downloaded == []


def started(second: float) -> datetime:
    return datetime(2026, 10, 27, 14, 0, tzinfo=UTC) + timedelta(seconds=second)


def lookup(*tracks: tuple[str, float]) -> Any:
    """면접방 이름으로 녹화 목록 조회를 대신하고, 조회한 면접방 이름을 기록한다."""
    calls: list[str] = []

    def track_starts(room: str) -> list[tuple[str, datetime]]:
        calls.append(room)
        return [(key, started(second)) for key, second in tracks]

    track_starts.calls = calls  # type: ignore[attr-defined]
    return track_starts


def placed_merge(placed: list[tuple[tuple[tuple[str, float], ...], ...]]) -> Any:
    def merge_placed(*kinds: Any) -> None:
        *tracks, output = kinds
        placed.append(
            tuple(tuple((p.track.name, p.offset_seconds) for p in kind) for kind in tracks)
        )
        output.write_bytes(b"mp4")

    return merge_placed


# 면접관 음성이 2초 먼저 시작하고, 지원자는 10초에 재접속했다
REJOIN_STARTS = (
    (REJOINED_VIDEO, 12.0),
    (VIDEO, 2.0),
    (CANDIDATE, 2.5),
    (REJOINED_CANDIDATE, 12.0),
    (INTERVIEWER, 0.0),
)
REJOIN_FILES = [*ALL, REJOINED_VIDEO, REJOINED_CANDIDATE]


def test_tracks_are_placed_at_recording_start_times(tmp_path: Path) -> None:
    clock = FakeTime()
    storage, results = FakeStorage(REJOIN_FILES), FakeResults()
    placed: list[tuple[tuple[tuple[str, float], ...], ...]] = []
    track_starts = lookup(*REJOIN_STARTS)

    merger(
        storage,
        results,
        tmp_path,
        merge_placed=placed_merge(placed),
        clock=clock,
        track_starts=track_starts,
    )(JOB)

    assert track_starts.calls == ["interview-55"]
    assert placed == [
        (
            (("candidate-video-TR_V1.mp4", 2.0), ("candidate-video-TR_V0.mp4", 12.0)),
            (("candidate-audio-TR_A1.ogg", 2.5), ("candidate-audio-TR_A0.ogg", 12.0)),
            (("interviewer-audio-TR_A2.ogg", 0.0),),
        )
    ]
    # 녹화가 모두 끝난 것을 녹화 목록으로 확인했으므로 저장소 목록 안정 대기를 하지 않는다
    assert storage.listed == 1
    assert clock.slept == []
    assert storage.uploaded == [("merged.mp4", "recordings/55.mp4")]
    # 가장 이른 면접관 음성 시작 시각이 영상 0초이고, 다시보기와 같은 한국 시간 밀리초로 전달한다
    assert results.published == [
        (
            "recording.merged",
            {
                "objectKey": "recordings/55.mp4",
                "recordingStartedAt": "2026-10-27T23:00:00.000+09:00",
            },
        )
    ]


@pytest.mark.parametrize(
    ("starts", "reason"),
    [
        ((), "녹화 목록이 빈다"),
        (((VIDEO, 2.0), (CANDIDATE, 2.5)), "한 종류가 없다"),
        ((*REJOIN_STARTS, (RAW + "candidate-video-TR_V9.mp4", 20.0)), "저장소에 없는 파일"),
    ],
)
def test_tracks_that_cannot_be_placed_are_appended_without_start_time(
    tmp_path: Path, starts: tuple[tuple[str, float], ...], reason: str
) -> None:
    """녹화 목록만으로 배치할 수 없으면 저장소 목록으로 이어 붙이고 시작 시각을 비운다."""
    storage, results = FakeStorage(REJOIN_FILES), FakeResults()
    merged: list[tuple[tuple[str, ...], ...]] = []
    placed: list[tuple[tuple[tuple[str, float], ...], ...]] = []

    merger(
        storage,
        results,
        tmp_path,
        merge=recording_merge(merged),
        merge_placed=placed_merge(placed),
        track_starts=lookup(*starts),
    )(JOB)

    assert placed == [], reason
    assert merged[0][0] == ("candidate-video-TR_V1.mp4", "candidate-video-TR_V0.mp4")
    assert results.published == [
        ("recording.merged", {"objectKey": "recordings/55.mp4", "recordingStartedAt": None})
    ]


def test_without_track_start_times_tracks_are_appended(tmp_path: Path) -> None:
    clock = FakeTime()
    storage, results = FakeStorage(ALL), FakeResults()
    placed: list[tuple[tuple[tuple[str, float], ...], ...]] = []

    merger(storage, results, tmp_path, merge_placed=placed_merge(placed), clock=clock)(JOB)

    assert placed == []
    assert clock.now == TRACK_SETTLE_SECONDS
    assert results.published == [
        ("recording.merged", {"objectKey": "recordings/55.mp4", "recordingStartedAt": None})
    ]


@pytest.mark.parametrize("fail_on", ["list", "upload"])
def test_storage_failures_are_storage_error(tmp_path: Path, fail_on: str) -> None:
    storage, results = FakeStorage(ALL), FakeResults()
    storage.fail_on = fail_on
    merger(storage, results, tmp_path)(JOB)
    assert results.published == [("recording.mergeFailed", {"reason": "STORAGE_ERROR"})]
    assert list(tmp_path.iterdir()) == []


def test_storage_that_cannot_be_created_is_storage_error(tmp_path: Path) -> None:
    def no_storage() -> FakeStorage:
        raise StorageError("S3_BUCKET이 없다")

    results = FakeResults()
    RecordingMerger(no_storage, results, work_root=tmp_path)(JOB)  # type: ignore[arg-type]
    assert results.published == [("recording.mergeFailed", {"reason": "STORAGE_ERROR"})]


@pytest.mark.parametrize(
    ("error", "reason"),
    [
        (MergeError("ffmpeg 종료 코드 1"), "MERGE_ERROR"),
        (ValueError("예상 못함"), "INTERNAL_ERROR"),
    ],
)
def test_merge_and_unexpected_failures(tmp_path: Path, error: Exception, reason: str) -> None:
    def merge(*paths: Path) -> None:
        raise error

    results = FakeResults()
    merger(FakeStorage(ALL), results, tmp_path, merge=merge)(JOB)
    assert results.published == [("recording.mergeFailed", {"reason": reason})]
    assert list(tmp_path.iterdir()) == []


def test_result_queue_failure_is_raised_so_job_stays(tmp_path: Path) -> None:
    results = FakeResults(ResultPublishError("결과 메시지 전송 4회 실패"))
    run_merge = merger(FakeStorage(ALL), results, tmp_path)
    with pytest.raises(ResultPublishError):
        run_merge(JOB)


FFMPEG = shutil.which("ffmpeg")


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg가 설치되지 않았다")
def test_real_ffmpeg_merge_from_storage(tmp_path: Path) -> None:
    assert FFMPEG is not None
    source = tmp_path / "s3"
    source.mkdir()
    inputs = {
        VIDEO: [
            "testsrc=duration=1:size=160x120:rate=10",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ],
        CANDIDATE: ["sine=duration=1", "-c:a", "libopus"],
        INTERVIEWER: ["sine=frequency=660:duration=1", "-c:a", "libopus"],
    }
    for key, (source_filter, *codec) in inputs.items():
        target = str(source / Path(key).name)
        command = [FFMPEG, "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi"]
        subprocess.run([*command, "-i", source_filter, *codec, target], check=True)
    work = tmp_path / "work"
    work.mkdir()
    storage, results = FakeStorage(ALL, source=source), FakeResults()
    clock = FakeTime()
    RecordingMerger(
        lambda: storage,
        results,  # type: ignore[arg-type]
        sleep=clock.sleep,
        clock=lambda: clock.now,
        work_root=work,
    )(JOB)
    assert results.published == [
        ("recording.merged", {"objectKey": "recordings/55.mp4", "recordingStartedAt": None})
    ]
    assert storage.uploaded == [("merged.mp4", "recordings/55.mp4")]


# 그룹 면접(AI 명세 7장): 그룹 면접방 녹화 위치에 참가자 두 명(55·56)과 면접관 트랙이 있다
GROUP_RAW = "recordings/raw/group-12/1794550000000/"
MY_VIDEO = GROUP_RAW + "candidate-55-video-TR_V1.mp4"
MY_AUDIO = GROUP_RAW + "candidate-55-audio-TR_A1.ogg"
OTHER_VIDEO = GROUP_RAW + "candidate-56-video-TR_V2.mp4"
OTHER_AUDIO = GROUP_RAW + "candidate-56-audio-TR_A2.ogg"
GROUP_INTERVIEWER = GROUP_RAW + "interviewer-audio-TR_A3.ogg"
GROUP_FILES = [MY_VIDEO, MY_AUDIO, OTHER_VIDEO, OTHER_AUDIO, GROUP_INTERVIEWER]
# 면접관 음성이 0초, 다른 참가자가 1초, 이 지원자가 3초에 녹화를 시작했다
GROUP_STARTS = (
    (GROUP_INTERVIEWER, 0.0),
    (OTHER_VIDEO, 1.0),
    (OTHER_AUDIO, 1.0),
    (MY_VIDEO, 3.0),
    (MY_AUDIO, 3.5),
)
GROUP_JOB = MergeRecordingJob(
    job_id=JOB.job_id,
    session_id=55,
    requested_at=JOB.requested_at,
    raw_prefix=GROUP_RAW,
    object_key="recordings/55.mp4",
    group=GroupRecording(
        room_name="group-12",
        candidate_identity="candidate-55",
        segments=(
            RecordingSegment(started(10.0), started(70.5)),
            RecordingSegment(started(200.0), started(260.0)),
        ),
    ),
)


def group_merge(merged: list[tuple[Any, ...]]) -> Any:
    def merge_group(*kinds: Any) -> None:
        *tracks, spans, output = kinds
        merged.append(
            (*(tuple((p.track.name, p.offset_seconds) for p in kind) for kind in tracks), spans)
        )
        output.write_bytes(b"mp4")

    return merge_group


def test_group_recording_uses_only_own_tracks_and_answer_segments(tmp_path: Path) -> None:
    """그룹 면접방 녹화에서 이 지원자와 면접관 트랙만 배치하고 본인 답변 구간만 합친다."""
    storage, results = FakeStorage(GROUP_FILES, prefix=GROUP_RAW), FakeResults()
    merged: list[tuple[Any, ...]] = []
    track_starts = lookup(*GROUP_STARTS)

    merger(storage, results, tmp_path, merge_group=group_merge(merged), track_starts=track_starts)(
        GROUP_JOB
    )

    assert track_starts.calls == ["group-12"]
    assert merged == [
        (
            (("candidate-55-video-TR_V1.mp4", 3.0),),
            (("candidate-55-audio-TR_A1.ogg", 3.5),),
            (("interviewer-audio-TR_A3.ogg", 0.0),),
            # 구간은 가장 이른 트랙(면접관 음성) 시작 시각 기준 초다
            [(10.0, 70.5), (200.0, 260.0)],
        )
    ]
    assert {key for key, _ in storage.downloaded} == {MY_VIDEO, MY_AUDIO, GROUP_INTERVIEWER}
    assert storage.uploaded == [("merged.mp4", "recordings/55.mp4")]
    # 잘라 붙인 영상의 0초는 첫 구간의 시작 시각이다
    assert results.published == [
        (
            "recording.merged",
            {
                "objectKey": "recordings/55.mp4",
                "recordingStartedAt": "2026-10-27T23:00:10.000+09:00",
            },
        )
    ]


def test_group_recording_without_start_times_fails_without_listing(tmp_path: Path) -> None:
    """그룹 면접은 업로드 순서로 이어 붙이지 않는다. 다른 참가자 차례가 남기 때문이다."""
    storage, results = FakeStorage(GROUP_FILES, prefix=GROUP_RAW), FakeResults()

    merger(storage, results, tmp_path)(GROUP_JOB)

    assert results.published == [("recording.mergeFailed", {"reason": "MERGE_ERROR"})]
    assert storage.listed == 0
    assert storage.downloaded == []


@pytest.mark.parametrize(
    "starts",
    [
        pytest.param(GROUP_STARTS[:3], id="own-tracks-not-recorded"),
        pytest.param(GROUP_STARTS[1:], id="interviewer-not-recorded"),
    ],
)
def test_group_recording_without_needed_track_is_track_not_found(
    tmp_path: Path, starts: tuple[tuple[str, float], ...]
) -> None:
    """다른 참가자의 트랙은 이 지원자의 트랙을 대신하지 않는다."""
    storage, results = FakeStorage(GROUP_FILES, prefix=GROUP_RAW), FakeResults()

    merger(storage, results, tmp_path, track_starts=lookup(*starts))(GROUP_JOB)

    assert results.published == [("recording.mergeFailed", {"reason": "TRACK_NOT_FOUND"})]
    assert storage.downloaded == []


def test_group_recording_with_listed_file_missing_in_storage_is_track_not_found(
    tmp_path: Path,
) -> None:
    stored = [key for key in GROUP_FILES if key != MY_AUDIO]
    storage, results = FakeStorage(stored, prefix=GROUP_RAW), FakeResults()

    merger(storage, results, tmp_path, track_starts=lookup(*GROUP_STARTS))(GROUP_JOB)

    assert results.published == [("recording.mergeFailed", {"reason": "TRACK_NOT_FOUND"})]
    assert storage.downloaded == []
