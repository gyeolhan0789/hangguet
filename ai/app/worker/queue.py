"""BE가 Redis 작업 큐에 추가한 분석 작업을 수신해 분배기로 전달한다(AI 명세 1.3).

BE는 작업 종류에 맞는 큐에 LPUSH하고,
작업자는 BLMOVE로 가장 오래된 작업을 처리 중 리스트로 옮겨 수신한다.
옮기는 동작이 원자적이므로 작업자가 처리 도중 중단돼도 작업은 처리 중 리스트에 남는다.
- 처리했거나 형식이 틀린 작업은 처리 중 리스트에서 삭제한다.
  형식 오류는 다시 수신해도 처리할 수 없기 때문이다.
  공통 필드(jobType·jobId·sessionId)를 읽을 수 있고 실패 결과가 있는 작업이면
  실패 결과(INVALID_JOB)를 먼저 전송해,
  화면이 BE 최대 대기 시간까지 기다리지 않게 한다(AI 명세 1.3).
  이 전송이 실패하면 작업을 남겨 다시 시작할 때 전송한다.
- 처리 함수가 없거나 실패한 작업은 남겨 둔다.
  즉시 되돌리면 같은 실패가 빠르게 반복되므로,
  작업자가 시작할 때 recover로 자기 큐에 되돌려 한 번 더 처리한다.
작업자는 큐마다 1대를 전제로 한다.
같은 큐에 여러 대면 recover가 다른 작업자의 처리 중 작업까지 되돌리므로,
큐마다 처리 중 리스트를 따로 둔다(AI 명세 1.3).
같은 작업이 두 번 처리돼 결과 메시지가 두 번 전송돼도 BE가 중복 결과를 제외한다(AI 명세 1.3·1.4).
"""

import json
import logging
from enum import StrEnum

from redis import Redis

from app.common.results import (
    REASON,
    FailureReason,
    ResultPublisher,
    ResultPublishError,
)
from app.common.settings import WORKER_QUEUE_ENV, SettingsError
from app.worker.dispatch import Dispatcher, DispatchResult
from app.worker.failures import FAILED_RESULT_OF_JOB
from app.worker.messages import InvalidJobError, job_header, parse_job

log = logging.getLogger(__name__)

# BE RedisAiJobQueue.KEY와 AI 명세 1.3의 이름이다
QUEUE_KEY = "ai:jobs"
PROCESSING_KEY = "ai:jobs:processing"
# 대기 한 번의 최대 시간(초).
# 종료 신호를 이 간격 안에 확인하도록 짧게 둔다.
# app.common.redis.SOCKET_TIMEOUT_SECONDS보다 길면 읽기 시간 초과로 수신이 정지하므로 짧게 유지한다
BLOCK_TIMEOUT_SECONDS = 5


class WorkerQueue(StrEnum):
    """작업자가 수신하는 큐(AI 명세 1.3). 값은 AI_WORKER_QUEUE 환경 변수 값이다."""

    DEFAULT = "default"
    PLAN = "plan"
    RECORDING = "recording"

    @property
    def key(self) -> str:
        # DEFAULT는 큐를 나누기 전부터 쓰던 이름을 유지해 BE 분기 전의 작업도 수신한다
        return QUEUE_KEY if self is WorkerQueue.DEFAULT else f"{QUEUE_KEY}:{self.value}"

    @property
    def processing_key(self) -> str:
        return f"{self.key}:processing"


def worker_queue(name: str | None) -> WorkerQueue:
    """AI_WORKER_QUEUE 값으로 큐를 고른다. 없으면 DEFAULT이고, 모르는 값이면 시작할 때 실패한다."""
    if name is None:
        return WorkerQueue.DEFAULT
    try:
        return WorkerQueue(name)
    except ValueError:
        choices = ", ".join(queue.value for queue in WorkerQueue)
        raise SettingsError(f"환경 변수 {WORKER_QUEUE_ENV}는 {choices} 중 하나여야 한다") from None


class ReceiveResult(StrEnum):
    EMPTY = "EMPTY"
    HANDLED = "HANDLED"
    INVALID = "INVALID"
    NO_HANDLER = "NO_HANDLER"
    FAILED = "FAILED"


def _trace_id(raw: str) -> str | None:
    """형식이 틀린 작업을 추적할 수 있도록 원문에서 jobId만 추출한다."""
    try:
        data = json.loads(raw)
    except (ValueError, RecursionError):
        return None
    job_id = data.get("jobId") if isinstance(data, dict) else None
    # UUID가 아닌 긴 값이 로그를 채우지 않도록 UUID 길이(36자)까지만 남긴다
    return job_id[:36] if isinstance(job_id, str) else None


def _text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode()
    return str(value)


class RedisJobQueue:
    def __init__(
        self,
        client: Redis,
        dispatcher: Dispatcher,
        results: ResultPublisher,
        *,
        queue: WorkerQueue = WorkerQueue.DEFAULT,
        block_timeout: int = BLOCK_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client
        self._dispatcher = dispatcher
        self._results = results
        self.queue = queue
        self._block_timeout = block_timeout

    def recover(self) -> int:
        """자기 처리 중 리스트에 남은 작업을 자기 큐로 되돌리고 그 수를 반환한다.

        처리 중 리스트의 왼쪽(가장 최근에 수신한 작업)부터 큐 오른쪽에 추가하므로
        먼저 수신했던 작업이 먼저 다시 처리된다.
        """
        moved = 0
        while (
            self._client.lmove(self.queue.processing_key, self.queue.key, "LEFT", "RIGHT")
            is not None
        ):
            moved += 1
        if moved:
            log.warning("처리 중 리스트의 작업 %d건을 %s로 되돌렸다", moved, self.queue.key)
        return moved

    def receive_once(self) -> ReceiveResult:
        """작업 하나를 기다려 처리한다.

        대기 시간 안에 작업이 없으면 EMPTY를 반환한다.
        """
        raw = _text(
            self._client.blmove(
                self.queue.key, self.queue.processing_key, self._block_timeout, "RIGHT", "LEFT"
            )
        )
        if raw is None:
            return ReceiveResult.EMPTY
        try:
            job = parse_job(raw)
        except InvalidJobError as e:
            # 원문에는 자소서·답변 글이 있으므로 로그에 남기지 않고 jobId와 오류 위치만 남긴다
            log.error("형식이 틀린 작업을 폐기한다: %s jobId=%s", e, _trace_id(raw))
            try:
                self._publish_invalid(raw)
            except ResultPublishError:
                log.exception(
                    "형식 오류 실패 결과를 전송하지 못해 작업을 남긴다 jobId=%s", _trace_id(raw)
                )
                return ReceiveResult.FAILED
            self._remove(raw)
            return ReceiveResult.INVALID
        result = self._dispatcher.dispatch(job)
        if result is DispatchResult.HANDLED:
            self._remove(raw)
        return ReceiveResult(result.value)

    def _publish_invalid(self, raw: str) -> None:
        header = job_header(raw)
        if header is None:
            return
        failed = FAILED_RESULT_OF_JOB.get(header.job_type)
        if failed is None:
            return
        self._results.publish(
            failed,
            header.session_id,
            {REASON: FailureReason.INVALID_JOB.value},
            job_id=header.job_id,
        )

    def _remove(self, raw: str) -> None:
        # 같은 원문이 여러 건이어도(Outbox 재발행) 이번에 수신한 1건만 삭제한다
        self._client.lrem(self.queue.processing_key, 1, raw)
