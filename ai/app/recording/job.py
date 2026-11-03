"""MERGE_RECORDING 작업 처리(AI 명세 7장).

원본 위치의 트랙을 임시 폴더에 다운로드해 합치고, 결과 위치에 업로드한 뒤 결과 메시지로 전달한다.
- 녹화 목록 조회로 트랙별 녹화 시작 시각을 얻으면 그 파일을 시작 시각 위치에 배치해 합치고,
  0초에 해당하는 시각(T0)을 recording.merged의 recordingStartedAt으로 전달한다.
- 시작 시각을 얻지 못했거나, 사용할 파일 중 한 종류라도 없거나, 목록의 파일이 저장소에 없으면
  원본 위치를 조회해 찾은 트랙을 이어 붙이고 recordingStartedAt을 null로 전달한다.
  다시보기가 이어 붙인 영상에 T0를 적용하면 마커가 영상과 맞지 않기 때문이다.
- 이때는 녹화가 끝나기 전에 작업이 등록되었을 수 있고,
  녹화 파일은 녹화가 끝난 뒤에 저장소에 올라간다.
  그래서 작업을 받은 시점에 트랙이 아직 없을 수 있으므로,
  세 종류가 모두 보일 때까지 일정 간격으로 다시 조회한다.
- 재접속 전 트랙은 면접 중에 먼저 업로드되므로
  세 종류가 보여도 마지막 트랙이 아직 업로드 중일 수 있다.
  그래서 세 종류가 보인 뒤에도 트랙 목록이 일정 시간 변하지 않을 때까지 기다린 뒤 합친다.
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
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from pathlib import Path, PurePosixPath

from app.common.results import (
    KST,
    REASON,
    FailureReason,
    ResultPublisher,
    ResultType,
)
from app.recording.egress import TrackStarts, no_track_starts
from app.recording.merge import (
    MergeError,
    MissingTrackError,
    Placed,
    PlacedTracks,
    Tracks,
    merge_placed_tracks,
    merge_tracks,
    place_tracks,
    select_tracks,
)
from app.recording.storage import RecordingStorage, StorageError
from app.worker.dispatch import Dispatcher
from app.worker.messages import MergeRecordingJob

log = logging.getLogger(__name__)

OBJECT_KEY = "objectKey"
RECORDING_STARTED_AT = "recordingStartedAt"
OUTPUT_FILE = "merged.mp4"
# 트랙이 모두 보일 때까지 다시 조회하는 간격과 최대 대기 시간(초, 임시 값).
# 실제 녹화 업로드 시간을 개발 서버에서 측정한 뒤 조정한다
TRACK_POLL_SECONDS = 5.0
TRACK_WAIT_SECONDS = 60.0
# 세 종류가 모두 보인 뒤 트랙 목록이 이 시간 동안 변하지 않으면 업로드가 끝났다고 본다(초, 임시 값).
# 방이 닫힐 때 마지막 트랙이 함께 업로드되므로 조회 3회 간격이면 남은 파일이 보인다고 보고,
# 개발 서버에서 트랙 사이 업로드 간격을 측정한 뒤 조정한다.
# 목록이 계속 변해도 작업자가 다른 작업을 처리하도록
# TRACK_WAIT_SECONDS + TRACK_SETTLE_SECONDS가 지나면 그때의 목록으로 합친다
TRACK_SETTLE_SECONDS = 15.0

MergeTracks = Callable[[Sequence[Path], Sequence[Path], Sequence[Path], Path], None]
PlacedFiles = Sequence[Placed[Path]]
MergePlacedTracks = Callable[[PlacedFiles, PlacedFiles, PlacedFiles, Path], None]
TrackStartLookup = Callable[[int], TrackStarts | None]


class _TrackWaitExpiredError(Exception):
    pass


@dataclass(frozen=True)
class _Merged:
    # 0초에 해당하는 시각. 이어 붙여 합쳤으면 None이다
    origin: datetime | None


class RecordingMerger:
    def __init__(
        self,
        storage: Callable[[], RecordingStorage],
        results: ResultPublisher,
        *,
        track_starts: TrackStartLookup = no_track_starts,
        merge: MergeTracks = merge_tracks,
        merge_placed: MergePlacedTracks = merge_placed_tracks,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        work_root: Path | None = None,
    ) -> None:
        """storage는 처음 처리할 때 저장소를 생성한다.

        S3 설정이 없어도 작업자가 시작되고 녹화 합치기만 실패하게 하기 위함이다.
        track_starts는 면접 id로 트랙 파일별 녹화 시작 시각을 조회하고, 얻지 못하면 None을 반환한다.
        """
        self._storage = storage
        self._results = results
        self._track_starts = track_starts
        self._merge = merge
        self._merge_placed = merge_placed
        self._sleep = sleep
        self._clock = clock
        self._work_root = work_root

    def __call__(self, job: MergeRecordingJob) -> None:
        # 작업마다 임시 폴더를 생성하고 성공·실패와 관계없이 삭제해
        # 원본 트랙과 mp4가 서버 디스크에 누적되지 않게 한다
        with tempfile.TemporaryDirectory(prefix="merge-recording-", dir=self._work_root) as work:
            outcome = self._merge_in(job, Path(work))
        if isinstance(outcome, FailureReason):
            self._results.publish_job_result(
                job, ResultType.RECORDING_MERGE_FAILED, {REASON: outcome.value}
            )
            return
        started_at = None
        if outcome.origin is not None:
            # 다시보기에서 질문 시각과의 차이로 마커 위치를 구하므로 밀리초까지 기록한다
            started_at = outcome.origin.astimezone(KST).isoformat(timespec="milliseconds")
        self._results.publish_job_result(
            job,
            ResultType.RECORDING_MERGED,
            {OBJECT_KEY: job.object_key, RECORDING_STARTED_AT: started_at},
        )

    def _merge_in(self, job: MergeRecordingJob, work: Path) -> FailureReason | _Merged:
        try:
            storage = self._storage()
            output = work / OUTPUT_FILE
            placed = self._placed_tracks(storage, job)
            if placed is None:
                merge = self._prepare_listed(storage, job.raw_prefix, work, output)
            else:
                merge = self._prepare_placed(storage, placed, work, output)
            started = time.monotonic()
            merge()
            log.info(
                "녹화 합치기 완료 sessionId=%s jobId=%s placed=%s seconds=%.1f",
                job.session_id,
                job.job_id,
                placed is not None,
                time.monotonic() - started,
            )
            storage.upload(output, job.object_key)
        except (_TrackWaitExpiredError, MissingTrackError) as e:
            return self._fail(job, FailureReason.TRACK_NOT_FOUND, e)
        except StorageError as e:
            return self._fail(job, FailureReason.STORAGE_ERROR, e)
        except MergeError as e:
            return self._fail(job, FailureReason.MERGE_ERROR, e)
        except Exception as e:
            return self._fail(job, FailureReason.INTERNAL_ERROR, e)
        return _Merged(None if placed is None else placed.origin)

    def _placed_tracks(
        self, storage: RecordingStorage, job: MergeRecordingJob
    ) -> PlacedTracks[str] | None:
        """녹화 시작 시각 위치에 배치한 트랙이다. 배치할 수 없으면 None이다."""
        starts = self._track_starts(job.session_id)
        if starts is None:
            return None
        try:
            placed = place_tracks(starts, job.raw_prefix)
        except MissingTrackError as e:
            log.warning("녹화 목록에 사용할 %s sessionId=%s", e, job.session_id)
            return None
        stored = {item.key for item in storage.list(job.raw_prefix)}
        tracks = (*placed.candidate_video, *placed.candidate_audio, *placed.interviewer_audio)
        missing = [track.track for track in tracks if track.track not in stored]
        if missing:
            log.warning(
                "녹화 목록의 파일이 저장소에 없다 sessionId=%s: %s",
                job.session_id,
                ", ".join(missing),
            )
            return None
        return placed

    def _prepare_listed(
        self, storage: RecordingStorage, raw_prefix: str, work: Path, output: Path
    ) -> Callable[[], None]:
        """원본 위치를 조회해 찾은 트랙을 다운로드하고, 이어 붙여 합치는 호출을 반환한다."""
        tracks = self._wait_for_tracks(storage, raw_prefix)
        video, candidate, interviewer = (
            [self._download(storage, key, work) for key in keys]
            for keys in (tracks.candidate_video, tracks.candidate_audio, tracks.interviewer_audio)
        )
        return partial(self._merge, video, candidate, interviewer, output)

    def _prepare_placed(
        self, storage: RecordingStorage, placed: PlacedTracks[str], work: Path, output: Path
    ) -> Callable[[], None]:
        """배치한 트랙을 다운로드하고, 녹화 시작 시각 위치에 배치해 합치는 호출을 반환한다."""
        video, candidate, interviewer = (
            [
                Placed(self._download(storage, track.track, work), track.offset_seconds)
                for track in tracks
            ]
            for tracks in (placed.candidate_video, placed.candidate_audio, placed.interviewer_audio)
        )
        return partial(self._merge_placed, video, candidate, interviewer, output)

    def _wait_for_tracks(self, storage: RecordingStorage, raw_prefix: str) -> Tracks:
        deadline = self._clock() + TRACK_WAIT_SECONDS
        settle_limit = deadline + TRACK_SETTLE_SECONDS
        seen: Tracks | None = None
        seen_at = 0.0
        while True:
            try:
                tracks = select_tracks(storage.list(raw_prefix), raw_prefix)
            except MissingTrackError as e:
                if self._clock() >= deadline:
                    raise _TrackWaitExpiredError(str(e)) from e
            else:
                now = self._clock()
                if tracks != seen:
                    seen, seen_at = tracks, now
                if now - seen_at >= TRACK_SETTLE_SECONDS or now >= settle_limit:
                    return tracks
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
