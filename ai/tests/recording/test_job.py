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
from app.worker.messages import MergeRecordingJob

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

    def __init__(self, *listings: list[str], source: Path | None = None) -> None:
        self.listings = list(listings)
        self.listed = 0
        self.source = source
        self.downloaded: list[tuple[str, Path]] = []
        self.uploaded: list[tuple[str, str]] = []
        self.fail_on: str | None = None

    def list(self, prefix: str) -> list[StoredObject]:
        assert prefix == RAW
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
    clock: FakeTime | None = None,
    track_starts: Any = None,
) -> RecordingMerger:
    time = clock or FakeTime()
    return RecordingMerger(
        lambda: storage,
        results,  # type: ignore[arg-type]
        track_starts=track_starts or (lambda _session_id: None),
        merge=merge,
        merge_placed=merge_placed,
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
    """면접 id로 녹화 목록 조회를 흉내 내고, 조회한 면접 id를 기록한다."""
    calls: list[int] = []

    def track_starts(session_id: int) -> list[tuple[str, datetime]]:
        calls.append(session_id)
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

    assert track_starts.calls == [55]
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
    with pytest.raises(ResultPublishError):
        merger(FakeStorage(ALL), results, tmp_path)(JOB)


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
