"""MERGE_RECORDING 작업 처리(AI 명세 7장).

원본 위치의 트랙을 임시 폴더에 다운로드해 합치고, 결과 위치에 업로드한 뒤 결과 메시지로 전달한다.
- BE는 합치기 작업을 등록한 뒤 면접방을 닫고, 방이 닫힌 뒤에 녹화 파일이 저장소에 올라간다.
  그래서 작업을 받은 시점에 트랙이 아직 없을 수 있으므로,
  세 종류가 모두 보일 때까지 일정 간격으로 다시 조회한다.
- 트랙 없음·저장소 실패·합치기 실패는 같은 작업을 다시 처리해도 결과가 같을 가능성이 높으므로
  recording.mergeFailed로 알리고 작업을 마친다(AI 명세 7장).
- 예상하지 못한 오류도 작업을 남기면 재시작할 때마다 반복되므로
  INTERNAL_ERROR로 알린다(AI 명세 5장).
- 결과 큐 전송 실패(ResultPublishError)는 처리하지 않고 전파해 작업이 처리 중 리스트에 남게 한다.
  결과 전송은 합치기 실패 처리 밖에서 하므로 INTERNAL_ERROR로 바뀌지 않는다.
"""

import logging
import tempfile
import time
from collections.abc import Callable
from pathlib import Path, PurePosixPath

from app.common.results import (
    REASON,
    FailureReason,
    ResultPublisher,
    ResultType,
)
from app.recording.merge import (
    MergeError,
    MissingTrackError,
    MultipleTracksError,
    Tracks,
    merge_tracks,
    select_tracks,
)
from app.recording.storage import RecordingStorage, StorageError
from app.worker.dispatch import Dispatcher
from app.worker.messages import MergeRecordingJob

log = logging.getLogger(__name__)

OBJECT_KEY = "objectKey"
OUTPUT_FILE = "merged.mp4"
# 트랙이 모두 보일 때까지 다시 조회하는 간격과 최대 대기 시간(초, 임시 값).
# 실제 녹화 업로드 시간을 개발 서버에서 측정한 뒤 조정한다
TRACK_POLL_SECONDS = 5.0
TRACK_WAIT_SECONDS = 60.0

MergeTracks = Callable[[Path, Path, Path, Path], None]


class _TrackWaitExpiredError(Exception):
    pass


class RecordingMerger:
    def __init__(
        self,
        storage: Callable[[], RecordingStorage],
        results: ResultPublisher,
        *,
        merge: MergeTracks = merge_tracks,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        work_root: Path | None = None,
    ) -> None:
        """storage는 처음 처리할 때 저장소를 생성한다.

        S3 설정이 없어도 작업자가 시작되고 녹화 합치기만 실패하게 하기 위함이다.
        """
        self._storage = storage
        self._results = results
        self._merge = merge
        self._sleep = sleep
        self._clock = clock
        self._work_root = work_root

    def __call__(self, job: MergeRecordingJob) -> None:
        # 작업마다 임시 폴더를 생성하고 성공·실패와 관계없이 삭제해
        # 원본 트랙과 mp4가 서버 디스크에 누적되지 않게 한다
        with tempfile.TemporaryDirectory(prefix="merge-recording-", dir=self._work_root) as work:
            reason = self._merge_in(job, Path(work))
        if reason is None:
            self._results.publish_job_result(
                job, ResultType.RECORDING_MERGED, {OBJECT_KEY: job.object_key}
            )
        else:
            self._results.publish_job_result(
                job, ResultType.RECORDING_MERGE_FAILED, {REASON: reason.value}
            )

    def _merge_in(self, job: MergeRecordingJob, work: Path) -> FailureReason | None:
        try:
            storage = self._storage()
            tracks = self._wait_for_tracks(storage, job.raw_prefix)
            video, candidate, interviewer = (
                self._download(storage, key, work)
                for key in (
                    tracks.candidate_video,
                    tracks.candidate_audio,
                    tracks.interviewer_audio,
                )
            )
            output = work / OUTPUT_FILE
            started = time.monotonic()
            self._merge(video, candidate, interviewer, output)
            log.info(
                "녹화 합치기 완료 sessionId=%s jobId=%s seconds=%.1f",
                job.session_id,
                job.job_id,
                time.monotonic() - started,
            )
            storage.upload(output, job.object_key)
        except _TrackWaitExpiredError as e:
            return self._fail(job, FailureReason.TRACK_NOT_FOUND, e)
        except StorageError as e:
            return self._fail(job, FailureReason.STORAGE_ERROR, e)
        except (MergeError, MultipleTracksError) as e:
            return self._fail(job, FailureReason.MERGE_ERROR, e)
        except Exception as e:
            return self._fail(job, FailureReason.INTERNAL_ERROR, e)
        return None

    def _wait_for_tracks(self, storage: RecordingStorage, raw_prefix: str) -> Tracks:
        deadline = self._clock() + TRACK_WAIT_SECONDS
        while True:
            try:
                return select_tracks(storage.list(raw_prefix), raw_prefix)
            except MissingTrackError as e:
                if self._clock() >= deadline:
                    raise _TrackWaitExpiredError(str(e)) from e
            self._sleep(TRACK_POLL_SECONDS)

    def _download(self, storage: RecordingStorage, key: str, work: Path) -> Path:
        # 확장자가 코덱마다 다르므로 ffmpeg가 형식을 알 수 있게 원래 파일 이름을 유지한다
        path = work / PurePosixPath(key).name
        storage.download(key, path)
        return path

    def _fail(
        self, job: MergeRecordingJob, reason: FailureReason, error: Exception
    ) -> FailureReason:
        # 원인이 분명하지 않은 오류만 추적 정보를 남긴다
        log.error(
            "녹화 합치기 실패 reason=%s sessionId=%s jobId=%s: %s",
            reason,
            job.session_id,
            job.job_id,
            error,
            exc_info=reason is FailureReason.INTERNAL_ERROR,
        )
        return reason


def register_merge_recording_handler(dispatcher: Dispatcher, handler: RecordingMerger) -> None:
    dispatcher.register(MergeRecordingJob, handler)
