"""자기소개서 검증 전용 큐(ai:checks)를 처리한다(AI 명세 2.1).

- 작업 큐(ai:jobs)와 따로 받아, 질문 생성·녹화 합치기 작업 뒤에 줄 서지 않게 한다.
- BE가 지원서 저장 요청 안에서 결과를 기다리므로 처리 중 리스트·결과 큐(ai:results)를 쓰지 않는다.
  결과는 작업마다 ai:checks:result:{jobId}에 넣고 일정 시간 뒤 사라지게 한다.
  처리 중에 작업자가 멈추면 그 검증은 버려지고, BE는 기다리다 시간 초과로 다시 시도하게 안내한다.
- BE가 기다리기를 포기한 작업(요청 후 BE_WAIT_SECONDS 경과)은 판단하지 않고 버린다.
- 메시지에는 자기소개서가 포함되므로 본문을 로그에 남기지 않는다.
"""

import json
import logging
import threading
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

from redis import Redis, RedisError

from app.common.cover_letter import (
    CoverLetterItem,
    InvalidCoverLetterError,
    parse_cover_letter_items,
)
from app.interview.cover_letter import CoverLetterCheckError

log = logging.getLogger(__name__)

CHECK_QUEUE_KEY = "ai:checks"
RESULT_KEY_PREFIX = "ai:checks:result:"
# 결과를 BE가 가져가지 않았을 때 남겨 두는 시간(초)
RESULT_TTL_SECONDS = 60
# AI 명세 2.1(임시 값): BE가 결과를 기다리는 상한(초)
BE_WAIT_SECONDS = 8.0
# 종료 신호를 확인하는 간격(초). 큐가 비어 있을 때 이만큼 기다린 뒤 다시 확인한다
RECEIVE_TIMEOUT_SECONDS = 1
RETRY_SECONDS = 5.0

USABLE = "usable"
ERROR = "error"
# 판단하지 못했다(Jev 장애·키 없음·메시지 형식 오류). BE는 다시 시도하도록 안내한다
CHECK_FAILED = "CHECK_FAILED"

# 회사명, 직무, 자기소개서 문항을 받아 통과 여부를 반환한다
Check = Callable[[str, str, tuple[CoverLetterItem, ...]], bool]


def result_key(job_id: str) -> str:
    return RESULT_KEY_PREFIX + job_id


class CoverLetterCheckWorker:
    def __init__(
        self,
        redis: Redis,
        check: Check | None,
        stop: threading.Event,
        *,
        now: Callable[[], float] = time.time,
        retry_seconds: float = RETRY_SECONDS,
    ) -> None:
        """check가 None이면(JEV_API_KEY 없음) 모든 작업에 CHECK_FAILED를 돌려준다."""
        self._redis = redis
        self._check = check
        self._stop = stop
        self._now = now
        self._retry_seconds = retry_seconds

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                self.receive_once()
            except RedisError:
                log.exception("Redis 연결 실패, %.0f초 뒤 다시 시도한다", self._retry_seconds)
                self._stop.wait(self._retry_seconds)
            except Exception:
                log.exception("자기소개서 검증 중 예상하지 못한 오류, 다음 작업을 계속 수신한다")
                self._stop.wait(self._retry_seconds)
        log.info("종료 신호를 수신해 자기소개서 검증을 종료한다")

    def receive_once(self) -> None:
        received = self._redis.brpop([CHECK_QUEUE_KEY], RECEIVE_TIMEOUT_SECONDS)
        if received is None:
            return
        _, raw = received
        message = _object(raw)
        job_id = message.get("jobId") if message is not None else None
        if not isinstance(job_id, str) or not job_id:
            log.warning("jobId를 읽을 수 없는 자기소개서 검증 작업을 버린다")
            return
        assert message is not None
        if self._expired(message.get("requestedAt")):
            log.warning("BE 대기 시간이 지난 자기소개서 검증 작업을 버린다 jobId=%s", job_id)
            return
        result = self._judge(job_id, message)
        key = result_key(job_id)
        pipe = self._redis.pipeline()
        pipe.lpush(key, json.dumps(result))
        pipe.expire(key, RESULT_TTL_SECONDS)
        pipe.execute()

    def _expired(self, requested_at: object) -> bool:
        """요청 시각을 읽을 수 없으면 기다리는 BE가 있을 수 있으므로 처리한다."""
        if not isinstance(requested_at, str):
            return False
        try:
            requested = datetime.fromisoformat(requested_at)
        except ValueError:
            return False
        if requested.tzinfo is None:
            return False
        return self._now() - requested.timestamp() > BE_WAIT_SECONDS

    def _judge(self, job_id: str, message: dict[str, Any]) -> dict[str, Any]:
        company_name, job_title = message.get("companyName"), message.get("jobTitle")
        try:
            items = parse_cover_letter_items(
                message.get("coverLetterItems"), message.get("coverLetter")
            )
        except InvalidCoverLetterError:
            log.warning("자기소개서 검증 작업의 형식이 맞지 않다 jobId=%s", job_id)
            return {ERROR: CHECK_FAILED}
        if not isinstance(company_name, str) or not isinstance(job_title, str):
            log.warning("자기소개서 검증 작업의 형식이 맞지 않다 jobId=%s", job_id)
            return {ERROR: CHECK_FAILED}
        if self._check is None:
            log.warning("JEV_API_KEY가 없어 자기소개서를 검증하지 못했다 jobId=%s", job_id)
            return {ERROR: CHECK_FAILED}
        started = time.monotonic()
        try:
            usable = self._check(company_name, job_title, items)
        except CoverLetterCheckError as e:
            log.warning("자기소개서 검증 실패 jobId=%s: %s", job_id, e)
            return {ERROR: CHECK_FAILED}
        log.info(
            "자기소개서 검증 완료 jobId=%s usable=%s seconds=%.2f",
            job_id,
            usable,
            time.monotonic() - started,
        )
        return {USABLE: usable}


def _object(raw: object) -> dict[str, Any] | None:
    if not isinstance(raw, str):
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None
