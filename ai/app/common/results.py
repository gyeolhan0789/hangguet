"""작업 결과와 진행 상태를 Redis 결과 큐(ai:results)에 전송한다(AI 명세 1.4).

분석 작업자의 작업 결과와 면접 에이전트의 질문 시작·답변 완료를 같은 전송기로 전송하므로,
어느 실행 진입점에도 의존하지 않도록 공용 모듈에 둔다.
AI는 DB와 진행 상태 Hash(session:{sessionId}:runtime)에 쓰지 않는다.
BE가 결과 큐에서 메시지를 꺼내 검증한 뒤 저장하므로, BE가 저장할 내용을 결과 메시지 하나에 담는다.
- 공통 필드는 type·sessionId·occurredAt이고, 작업 결과에는 수신한 작업의 jobId를 담는다.
  BE는 jobId로 재생성 이전 시도의 늦은 결과를 구분한다(AI 명세 1.4).
- LPUSH가 실패하면 짧은 간격으로 재시도한다.
  응답만 유실돼 같은 메시지가 두 번 추가돼도
  BE가 유일 제약과 상태 조건으로 중복을 제외한다(AI 명세 1.4).
"""

import json
import logging
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from typing import Any, Protocol

from redis import Redis, RedisError

log = logging.getLogger(__name__)

# AI 명세 1.4의 이름이다.
# BE가 BLMOVE로 ai:results:processing에 옮겨 처리한다
RESULT_QUEUE_KEY = "ai:results"
# AI 명세 5장: 결과 큐 전송은 1·2·4초 간격으로 3회 재시도한다
BACKOFF_SECONDS = (1.0, 2.0, 4.0)
# 명세 예시(2026-10-22T14:03:12+09:00)와 같이 한국 시간으로 기록한다.
# 한국은 서머타임이 없어 고정 오프셋과 지역 시간대가 같고, 컨테이너에 시간대 자료가 없어도 동작한다
KST = timezone(timedelta(hours=9))

TYPE = "type"
SESSION_ID = "sessionId"
JOB_ID = "jobId"
OCCURRED_AT = "occurredAt"
_COMMON_FIELDS = frozenset({TYPE, SESSION_ID, JOB_ID, OCCURRED_AT})


class ResultType(StrEnum):
    """결과 메시지 종류(AI 명세 1.4)."""

    PLAN_PROGRESS = "plan.progress"
    PLAN_COMPLETED = "plan.completed"
    PLAN_FAILED = "plan.failed"
    ANSWER_SCORED = "answer.scored"
    EVALUATION_PROGRESS = "evaluation.progress"
    EVALUATION_COMPLETED = "evaluation.completed"
    EVALUATION_FAILED = "evaluation.failed"
    RECORDING_MERGED = "recording.merged"
    RECORDING_MERGE_FAILED = "recording.mergeFailed"
    # 임시: WRITE_HEADLINE 결과(AI 명세 4.1)
    HEADLINE_WRITTEN = "headline.written"
    QUESTION_STARTED = "question.started"
    ANSWER_COMPLETED = "answer.completed"


# 면접 에이전트가 전송하는 두 종류는 작업 결과가 아니므로 jobId가 없다
AGENT_RESULT_TYPES = frozenset({ResultType.QUESTION_STARTED, ResultType.ANSWER_COMPLETED})

REASON = "reason"


class FailureReason(StrEnum):
    """실패 결과 메시지의 reason 허용 값(AI 명세 1.4 실패 이유).

    값의 뜻은 명세 표를 따른다.
    BE가 값으로 처리를 나누므로 자유 문장 대신 이 목록의 값 하나를 전송한다.
    """

    GMS_UNAVAILABLE = "GMS_UNAVAILABLE"
    INVALID_OUTPUT = "INVALID_OUTPUT"
    TIMED_OUT = "TIMED_OUT"
    TRACK_NOT_FOUND = "TRACK_NOT_FOUND"
    STORAGE_ERROR = "STORAGE_ERROR"
    MERGE_ERROR = "MERGE_ERROR"
    INVALID_JOB = "INVALID_JOB"
    INTERNAL_ERROR = "INTERNAL_ERROR"


_REASON_VALUES = frozenset(reason.value for reason in FailureReason)
# 실패 결과 메시지는 BE가 reason으로 처리를 나누므로 목록의 값을 반드시 담는다.
# 작업 종류별 대응은 분석 작업자(app.worker.failures)가 이 목록의 값으로 정한다
FAILED_RESULT_TYPES = frozenset(
    {ResultType.PLAN_FAILED, ResultType.EVALUATION_FAILED, ResultType.RECORDING_MERGE_FAILED}
)


class JobRef(Protocol):
    """결과를 전송할 작업.

    작업 메시지 형식(app.worker.messages)에 의존하지 않도록 결과 메시지에 담는 값만 요구한다.
    """

    @property
    def session_id(self) -> int: ...

    @property
    def job_id(self) -> str: ...


class ResultPublishError(Exception):
    """재시도를 모두 실패해 결과 메시지를 결과 큐에 추가하지 못했다."""


def _now() -> datetime:
    return datetime.now(KST)


class ResultPublisher:
    def __init__(
        self,
        client: Redis,
        *,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], datetime] = _now,
    ) -> None:
        self._client = client
        self._sleep = sleep
        self._clock = clock

    def publish_job_result(
        self, job: JobRef, result_type: ResultType, fields: Mapping[str, Any]
    ) -> None:
        """작업 처리 결과를 전송한다.

        sessionId·jobId는 수신한 작업의 값을 그대로 담는다.
        """
        self.publish(result_type, job.session_id, fields, job_id=job.job_id)

    def publish(
        self,
        result_type: ResultType,
        session_id: int,
        fields: Mapping[str, Any],
        *,
        job_id: str | None = None,
    ) -> None:
        """결과 메시지를 결과 큐에 추가한다.

        재시도까지 실패하면 ResultPublishError를 발생시킨다.
        분석 작업자의 처리 함수는 이 오류를 처리하지 않고 전파해,
        작업이 처리 중 리스트에 남아 작업자를 다시 시작할 때 한 번 더 처리되게 한다.
        """
        raw = self._encode(ResultType(result_type), session_id, fields, job_id)
        for attempt in range(len(BACKOFF_SECONDS) + 1):
            try:
                self._client.lpush(RESULT_QUEUE_KEY, raw)
                return
            except RedisError as e:
                if attempt == len(BACKOFF_SECONDS):
                    raise ResultPublishError(
                        f"결과 메시지 전송 {attempt + 1}회 실패 type={result_type}"
                    ) from e
                log.warning(
                    "결과 메시지 전송 재시도 %d/%d type=%s sessionId=%s (%s)",
                    attempt + 1,
                    len(BACKOFF_SECONDS),
                    result_type,
                    session_id,
                    type(e).__name__,
                )
                self._sleep(BACKOFF_SECONDS[attempt])

    def _encode(
        self,
        result_type: ResultType,
        session_id: int,
        fields: Mapping[str, Any],
        job_id: str | None,
    ) -> str:
        # BE가 처리하지 못하는 메시지는 결과 큐에 추가하기 전에 프로그램 오류로 처리한다
        if (job_id is None) != (result_type in AGENT_RESULT_TYPES):
            raise ValueError(f"{result_type}의 jobId는 작업 결과에만 담는다")
        if overlap := _COMMON_FIELDS & fields.keys():
            raise ValueError(f"공통 필드는 내용에 포함하지 않는다: {sorted(overlap)}")
        reason = fields.get(REASON)
        if result_type in FAILED_RESULT_TYPES and not (
            isinstance(reason, str) and reason in _REASON_VALUES
        ):
            raise ValueError(f"{result_type}의 reason은 FailureReason 값이어야 한다")
        message: dict[str, Any] = {TYPE: result_type.value, SESSION_ID: session_id}
        if job_id is not None:
            message[JOB_ID] = job_id
        message.update(fields)
        message[OCCURRED_AT] = self._clock().isoformat(timespec="seconds")
        # NaN·Infinity는 JSON 표준이 아니어서 BE가 해석하지 못하므로 거부한다
        return json.dumps(message, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
