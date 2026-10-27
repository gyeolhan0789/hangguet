import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app.common.results import ResultPublishError
from app.recording.job import (
    TRACK_POLL_SECONDS,
    TRACK_WAIT_SECONDS,
    RecordingMerger,
)
from app.recording.merge import MergeError
from app.recording.storage import StorageError
from app.worker.messages import MergeRecordingJob

RAW = "recordings/raw/55/"
VIDEO = RAW + "candidate-video-TR_V1.mp4"
CANDIDATE = RAW + "candidate-audio-TR_A1.ogg"
INTERVIEWER = RAW + "interviewer-audio-TR_A2.ogg"
ALL = [VIDEO, CANDIDATE, INTERVIEWER]
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

    def list(self, prefix: str) -> list[str]:
        assert prefix == RAW
        if self.fail_on == "list":
            raise StorageError("목록 조회 실패")
        listing = self.listings[min(self.listed, len(self.listings) - 1)]
        self.listed += 1
        return listing

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
        assert job is JOB
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


def fake_merge(*paths: Path) -> None:
    paths[-1].write_bytes(b"mp4")


def merger(
    storage: FakeStorage,
    results: FakeResults,
    tmp_path: Path,
    *,
    merge: Any = fake_merge,
    clock: FakeTime | None = None,
) -> RecordingMerger:
    time = clock or FakeTime()
    return RecordingMerger(
        lambda: storage,
        results,  # type: ignore[arg-type]
        merge=merge,
        sleep=time.sleep,
        clock=lambda: time.now,
        work_root=tmp_path,
    )


def test_tracks_are_merged_and_uploaded_to_object_key(tmp_path: Path) -> None:
    storage, results = FakeStorage(ALL), FakeResults()
    merged: list[tuple[str, ...]] = []

    def merge(*paths: Path) -> None:
        merged.append(tuple(path.name for path in paths))
        fake_merge(*paths)

    merger(storage, results, tmp_path, merge=merge)(JOB)

    assert [key for key, _ in storage.downloaded] == ALL
    # ffmpeg가 형식을 알 수 있도록 원래 파일 이름(확장자)을 유지한다
    assert merged == [
        (
            "candidate-video-TR_V1.mp4",
            "candidate-audio-TR_A1.ogg",
            "interviewer-audio-TR_A2.ogg",
            "merged.mp4",
        )
    ]
    assert storage.uploaded == [("merged.mp4", "recordings/55.mp4")]
    assert results.published == [("recording.merged", {"objectKey": "recordings/55.mp4"})]
    # 임시 폴더는 처리 뒤 삭제한다
    assert list(tmp_path.iterdir()) == []


def test_waits_until_tracks_still_uploading_appear(tmp_path: Path) -> None:
    clock = FakeTime()
    storage, results = FakeStorage([VIDEO], [VIDEO, CANDIDATE], ALL), FakeResults()
    merger(storage, results, tmp_path, clock=clock)(JOB)
    assert clock.slept == [TRACK_POLL_SECONDS, TRACK_POLL_SECONDS]
    assert results.published[0][0] == "recording.merged"


def test_track_not_found_after_waiting_limit(tmp_path: Path) -> None:
    clock = FakeTime()
    storage, results = FakeStorage([VIDEO, CANDIDATE]), FakeResults()
    merger(storage, results, tmp_path, clock=clock)(JOB)
    assert results.published == [("recording.mergeFailed", {"reason": "TRACK_NOT_FOUND"})]
    # 마지막 조회는 대기 상한 시각에 한다
    assert clock.now == TRACK_WAIT_SECONDS
    assert storage.listed == int(TRACK_WAIT_SECONDS / TRACK_POLL_SECONDS) + 1
    assert storage.downloaded == []


def test_multiple_tracks_of_a_kind_fail_without_waiting(tmp_path: Path) -> None:
    clock = FakeTime()
    storage = FakeStorage([*ALL, RAW + "candidate-video-TR_V2.mp4"])
    results = FakeResults()
    merger(storage, results, tmp_path, clock=clock)(JOB)
    assert results.published == [("recording.mergeFailed", {"reason": "MERGE_ERROR"})]
    assert clock.slept == []


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
    RecordingMerger(lambda: storage, results, work_root=work)(JOB)  # type: ignore[arg-type]
    assert results.published == [("recording.merged", {"objectKey": "recordings/55.mp4"})]
    assert storage.uploaded == [("merged.mp4", "recordings/55.mp4")]
