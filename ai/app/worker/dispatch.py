"""작업 종류별 처리 함수를 등록하고 작업을 전달한다.

처리 함수는 이 분배기 하나에만 등록하므로, 큐 수신부는 결과만 보고 작업을 삭제할지 정한다.
- HANDLED: 처리를 마쳤으므로 큐 수신부가 작업을 삭제한다.
- NO_HANDLER: 처리 함수가 아직 배포되지 않은 종류다.
  삭제하면 작업이 유실되므로 남겨 둔다.
- FAILED: 처리 함수가 처리하지 않고 전파한 예외다(결과 큐 전송 실패 등).
  즉시 다시 처리하면 같은 실패가 반복되므로
  큐 수신부는 작업을 남겨 두고 작업자를 다시 시작할 때 한 번 더 처리한다.
"""

import logging
from collections.abc import Callable
from enum import StrEnum
from typing import Any

from app.worker.messages import Job, JobType

log = logging.getLogger(__name__)


class DispatchResult(StrEnum):
    HANDLED = "HANDLED"
    NO_HANDLER = "NO_HANDLER"
    FAILED = "FAILED"


class DuplicateHandlerError(ValueError):
    """같은 작업 종류에 처리 함수를 두 번 등록했다."""


class Dispatcher:
    def __init__(self) -> None:
        # 등록할 때 작업 클래스와 처리 함수의 형식을 일치시키므로 값은 Any 인자로 보관한다
        self._handlers: dict[JobType, Callable[[Any], None]] = {}

    def register[J: Job](self, job_class: type[J], handler: Callable[[J], None]) -> None:
        """작업 클래스(PlanJob 등)의 처리 함수를 등록한다.

        작업 클래스로 등록하므로 처리 함수는 그 작업의 필드를 형식 검사된 상태로 사용한다.
        """
        job_type = job_class.job_type
        # 나중에 등록한 함수가 앞의 함수를 조용히 대체하지 않도록 중복 등록을 거부한다
        if job_type in self._handlers:
            raise DuplicateHandlerError(f"{job_type} 처리 함수가 이미 등록돼 있다")
        self._handlers[job_type] = handler

    def dispatch(self, job: Job) -> DispatchResult:
        handler = self._handlers.get(job.job_type)
        if handler is None:
            log.warning("처리 함수 없음 jobType=%s jobId=%s", job.job_type, job.job_id)
            return DispatchResult.NO_HANDLER
        try:
            handler(job)
        except Exception:
            # 재시도는 GMS 호출과 결과 전송 계층이 담당하므로(AI 명세 5장)
            # 여기서는 기록만 하고 다음 작업을 처리한다
            log.exception(
                "작업 처리 실패 jobType=%s jobId=%s sessionId=%s",
                job.job_type,
                job.job_id,
                job.session_id,
            )
            return DispatchResult.FAILED
        return DispatchResult.HANDLED
