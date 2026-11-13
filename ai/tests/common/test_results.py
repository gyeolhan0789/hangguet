import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from redis import ConnectionError as RedisConnectionError
from redis import Redis, RedisError
from redis import TimeoutError as RedisTimeoutError

from app.common.results import (
    AGENT_RESULT_TYPES,
    APPLICATION_RESULT_TYPES,
    BACKOFF_SECONDS,
    FAILED_RESULT_TYPES,
    GROUP_RESULT_QUEUE_KEY,
    KST,
    RESULT_QUEUE_KEY,
    FailureReason,
    ResultPublisher,
    ResultPublishError,
    ResultType,
)

JOB_ID = "8f0c2a4e-1b3d-4c5f-9a7e-6d8b0c1e2f3a"


@dataclass(frozen=True)
class Job:
    """결과를 전송할 작업(JobRef).

    작업 메시지 형식에 의존하지 않고 필요한 값만 둔다.
    """

    session_id: int
    job_id: str


PLAN = Job(session_id=55, job_id=JOB_ID)
NOW = datetime(2026, 10, 22, 14, 3, 12, 987000, tzinfo=KST)


class FakeRedis:
    """LPUSH만 같은 의미로 구현하고, 정해진 횟수만큼 먼저 실패하는 대역."""

    def __init__(self, failures: list[RedisError] | None = None) -> None:
        self.lists: dict[str, list[str]] = {}
        self.calls = 0
        self._failures = list(failures or [])

    def lpush(self, key: str, *values: str) -> int:
        self.calls += 1
        if self._failures:
            raise self._failures.pop(0)
        items = self.lists.setdefault(key, [])
        for value in values:
            items.insert(0, value)
        return len(items)


def make(redis: FakeRedis, sleeps: list[float] | None = None) -> ResultPublisher:
    record = sleeps if sleeps is not None else []
    return ResultPublisher(cast(Redis, redis), sleep=record.append, clock=lambda: NOW)


def pushed(redis: FakeRedis) -> list[dict[str, Any]]:
    return [json.loads(raw) for raw in redis.lists.get(RESULT_QUEUE_KEY, [])]


def test_job_result_carries_common_fields_and_received_job_id() -> None:
    """작업 결과에는 type·sessionId·jobId·occurredAt을 담는다(AI 명세 1.4)."""
    redis = FakeRedis()

    make(redis).publish_job_result(PLAN, ResultType.PLAN_PROGRESS, {"progress": 50})

    assert pushed(redis) == [
        {
            "type": "plan.progress",
            "sessionId": 55,
            "jobId": JOB_ID,
            "progress": 50,
            "occurredAt": "2026-10-22T14:03:12.987+09:00",
        }
    ]


def test_occurred_at_is_iso_8601_with_offset() -> None:
    redis = FakeRedis()
    utc = datetime(2026, 10, 22, 5, 3, 12, tzinfo=UTC)

    ResultPublisher(cast(Redis, redis), clock=lambda: utc).publish_job_result(
        PLAN, ResultType.PLAN_FAILED, {"reason": "GMS_UNAVAILABLE"}
    )

    occurred = datetime.fromisoformat(pushed(redis)[0]["occurredAt"])
    assert occurred.utcoffset() is not None
    assert occurred == utc


def test_default_clock_uses_korean_time_offset() -> None:
    redis = FakeRedis()

    ResultPublisher(cast(Redis, redis)).publish_job_result(
        PLAN, ResultType.PLAN_PROGRESS, {"progress": 50}
    )

    assert pushed(redis)[0]["occurredAt"].endswith("+09:00")


def test_agent_result_has_no_job_id() -> None:
    """면접 에이전트의 질문 시작·답변 완료는 작업 결과가 아니므로 jobId가 없다."""
    redis = FakeRedis()

    make(redis).publish(
        ResultType.QUESTION_STARTED, 55, {"seq": 3, "startedAt": "2026-10-22T14:02:10+09:00"}
    )

    [message] = pushed(redis)
    assert message == {
        "type": "question.started",
        "sessionId": 55,
        "seq": 3,
        "startedAt": "2026-10-22T14:02:10+09:00",
        "occurredAt": "2026-10-22T14:03:12.987+09:00",
    }


def test_assignment_rejected_is_agent_result_with_reason() -> None:
    """배정 거절은 작업 결과가 아니므로 jobId가 없고, BE가 reason으로 처리한다(AI 명세 1.4)."""
    redis = FakeRedis()

    make(redis).publish(ResultType.ASSIGNMENT_REJECTED, 55, {"reason": "INVALID_ASSIGNMENT"})

    assert pushed(redis) == [
        {
            "type": "assignment.rejected",
            "sessionId": 55,
            "reason": "INVALID_ASSIGNMENT",
            "occurredAt": "2026-10-22T14:03:12.987+09:00",
        }
    ]


@pytest.mark.parametrize("fields", [{}, {"reason": "배정 거절"}])
def test_assignment_rejected_rejects_reason_outside_list(fields: dict[str, Any]) -> None:
    redis = FakeRedis()

    publisher = make(redis)
    with pytest.raises(ValueError, match="reason"):
        publisher.publish(ResultType.ASSIGNMENT_REJECTED, 55, fields)

    assert redis.calls == 0


def test_keeps_korean_text_as_is() -> None:
    redis = FakeRedis()

    make(redis).publish_job_result(
        PLAN, ResultType.PLAN_COMPLETED, {"claims": [{"text": "캐시 계층을 설계했다"}]}
    )

    assert "캐시 계층을 설계했다" in redis.lists[RESULT_QUEUE_KEY][0]


def test_messages_are_pushed_to_left_so_backend_reads_oldest_first() -> None:
    """BE가 BLMOVE … RIGHT LEFT로 오른쪽부터 수신하므로 먼저 전송한 메시지가 오른쪽 끝에 있다."""
    redis = FakeRedis()
    publisher = make(redis)

    publisher.publish_job_result(PLAN, ResultType.PLAN_PROGRESS, {"progress": 50})
    publisher.publish_job_result(PLAN, ResultType.PLAN_COMPLETED, {"claims": []})

    assert [m["type"] for m in pushed(redis)] == ["plan.completed", "plan.progress"]


def test_retries_after_redis_error_with_backoff(caplog: pytest.LogCaptureFixture) -> None:
    redis = FakeRedis([RedisConnectionError("reset"), RedisTimeoutError("timeout")])
    sleeps: list[float] = []

    with caplog.at_level(logging.WARNING, logger="app.common.results"):
        make(redis, sleeps).publish_job_result(PLAN, ResultType.PLAN_PROGRESS, {"progress": 50})

    assert redis.calls == 3
    assert sleeps == list(BACKOFF_SECONDS[:2])
    assert len(pushed(redis)) == 1
    assert len(caplog.records) == 2


def test_raises_after_every_retry_fails() -> None:
    """재시도까지 실패하면 오류를 전파해 작업이 처리 중 리스트에 남게 한다."""
    failures: list[RedisError] = [RedisConnectionError("down")] * (len(BACKOFF_SECONDS) + 1)
    redis = FakeRedis(failures)
    sleeps: list[float] = []

    publisher = make(redis, sleeps)
    with pytest.raises(ResultPublishError, match="plan.progress"):
        publisher.publish_job_result(PLAN, ResultType.PLAN_PROGRESS, {"progress": 50})

    assert redis.calls == len(BACKOFF_SECONDS) + 1
    assert sleeps == list(BACKOFF_SECONDS)
    assert pushed(redis) == []


def test_retried_message_is_identical() -> None:
    """재시도 사이에 시각이 변경돼도 같은 메시지를 전송한다."""
    times = iter([NOW, datetime(2026, 10, 22, 15, 0, tzinfo=KST)])
    redis = FakeRedis([RedisConnectionError("reset")])
    publisher = ResultPublisher(cast(Redis, redis), sleep=lambda s: None, clock=lambda: next(times))

    publisher.publish_job_result(PLAN, ResultType.PLAN_PROGRESS, {"progress": 50})

    assert pushed(redis)[0]["occurredAt"] == "2026-10-22T14:03:12.987+09:00"


@pytest.mark.parametrize("key", ["type", "sessionId", "applicationId", "jobId", "occurredAt"])
def test_fields_cannot_override_common_fields(key: str) -> None:
    redis = FakeRedis()

    publisher = make(redis)
    with pytest.raises(ValueError, match=key):
        publisher.publish_job_result(PLAN, ResultType.PLAN_PROGRESS, {key: "x"})

    assert redis.calls == 0


@pytest.mark.parametrize(
    "result_type", sorted(set(ResultType) - AGENT_RESULT_TYPES - APPLICATION_RESULT_TYPES)
)
def test_job_result_types_require_job_id(result_type: ResultType) -> None:
    redis = FakeRedis()

    publisher = make(redis)
    with pytest.raises(ValueError, match="jobId"):
        publisher.publish(result_type, 55, {})

    assert redis.calls == 0


@pytest.mark.parametrize("result_type", sorted(AGENT_RESULT_TYPES))
def test_agent_result_types_reject_job_id(result_type: ResultType) -> None:
    redis = FakeRedis()

    publisher = make(redis)
    with pytest.raises(ValueError, match="jobId"):
        publisher.publish(result_type, 55, {"seq": 1}, job_id=JOB_ID)

    assert redis.calls == 0


def test_non_finite_number_is_rejected_before_push() -> None:
    """NaN은 JSON 표준이 아니어서 BE가 해석하지 못한다."""
    redis = FakeRedis()

    publisher = make(redis)
    fields = {"progress": float("nan")}
    with pytest.raises(ValueError):
        publisher.publish_job_result(PLAN, ResultType.PLAN_PROGRESS, fields)

    assert redis.calls == 0


def test_result_type_values_match_spec() -> None:
    """AI 명세 1.4 표와 6.7(그룹 면접에서 새로 생긴 종류)의 type 이름과 같다."""
    assert {t.value for t in ResultType} == {
        "plan.progress",
        "plan.completed",
        "plan.failed",
        "claims.extracted",
        "claims.extractFailed",
        "answer.scored",
        "evaluation.progress",
        "evaluation.completed",
        "evaluation.failed",
        "recording.merged",
        "recording.mergeFailed",
        "question.started",
        "answer.completed",
        "assignment.rejected",
        "room.closed",
        "question.spoken",
        "followup.decided",
    }


def test_failed_result_types_match_spec() -> None:
    """AI 명세 1.4 표에서 내용이 reason인 종류다."""
    assert {t.value for t in FAILED_RESULT_TYPES} == {
        "plan.failed",
        "claims.extractFailed",
        "evaluation.failed",
        "recording.mergeFailed",
        "assignment.rejected",
    }


@pytest.mark.parametrize("reason", sorted(FailureReason))
def test_failed_result_accepts_listed_reason(reason: FailureReason) -> None:
    redis = FakeRedis()

    make(redis).publish_job_result(PLAN, ResultType.PLAN_FAILED, {"reason": reason})

    assert pushed(redis)[0]["reason"] == reason.value


@pytest.mark.parametrize(
    "result_type", sorted(FAILED_RESULT_TYPES - AGENT_RESULT_TYPES - APPLICATION_RESULT_TYPES)
)
@pytest.mark.parametrize(
    "fields",
    [{}, {"reason": "자소서 분석 실패"}, {"reason": None}, {"reason": ["GMS_UNAVAILABLE"]}],
)
def test_failed_result_rejects_reason_outside_list(
    result_type: ResultType, fields: dict[str, Any]
) -> None:
    """BE가 reason 값으로 처리를 나누므로 목록에 없는 값은 결과 큐에 추가하기 전에 거부한다."""
    redis = FakeRedis()

    publisher = make(redis)
    with pytest.raises(ValueError, match="reason"):
        publisher.publish_job_result(PLAN, result_type, fields)

    assert redis.calls == 0


def test_application_result_carries_application_id_instead_of_session_id() -> None:
    """주장 추출은 지원서 단위 작업이므로 결과에 applicationId를 담는다(AI 명세 1.3)."""
    redis = FakeRedis()

    make(redis).publish_application_result(
        ResultType.CLAIMS_EXTRACTED, 7, {"claims": []}, job_id=JOB_ID
    )

    assert pushed(redis) == [
        {
            "type": "claims.extracted",
            "applicationId": 7,
            "jobId": JOB_ID,
            "claims": [],
            "occurredAt": "2026-10-22T14:03:12.987+09:00",
        }
    ]


@pytest.mark.parametrize("result_type", sorted(APPLICATION_RESULT_TYPES))
def test_application_result_type_rejects_session_id(result_type: ResultType) -> None:
    """BE가 지원서 단위 결과를 sessionId로 해석하지 않도록 결과 큐에 추가하기 전에 거부한다."""
    redis = FakeRedis()

    publisher = make(redis)
    with pytest.raises(ValueError, match="applicationId"):
        publisher.publish_job_result(PLAN, result_type, {"reason": "GMS_UNAVAILABLE"})

    assert redis.calls == 0


def test_session_result_type_rejects_application_id() -> None:
    redis = FakeRedis()

    publisher = make(redis)
    with pytest.raises(ValueError, match="sessionId"):
        publisher.publish_application_result(ResultType.PLAN_FAILED, 7, {}, job_id=JOB_ID)

    assert redis.calls == 0


@pytest.mark.parametrize("fields", [{}, {"reason": "주장 추출 실패"}])
def test_application_failed_result_rejects_reason_outside_list(fields: dict[str, Any]) -> None:
    redis = FakeRedis()

    publisher = make(redis)
    with pytest.raises(ValueError, match="reason"):
        publisher.publish_application_result(
            ResultType.CLAIMS_EXTRACT_FAILED, 7, fields, job_id=JOB_ID
        )

    assert redis.calls == 0


def test_failure_reasons_match_spec_table() -> None:
    """reason은 AI 명세 1.4 실패 이유 표의 값 10개만 정의한다.

    BE가 값으로 처리를 나누기 때문이다.
    """
    values = [reason.value for reason in FailureReason]

    assert values == [
        "GMS_UNAVAILABLE",
        "INVALID_OUTPUT",
        "TIMED_OUT",
        "TRACK_NOT_FOUND",
        "STORAGE_ERROR",
        "MERGE_ERROR",
        "INVALID_JOB",
        "INTERNAL_ERROR",
        "INVALID_ASSIGNMENT",
    ]
    assert all(value == reason.name for value, reason in zip(values, FailureReason, strict=True))


# 기준: AI 명세 1.4 · 6.7(그룹 면접의 면접 에이전트 결과는 ai:results:group으로 보낸다)
def test_group_publisher_pushes_to_group_queue() -> None:
    redis = FakeRedis()

    publisher = ResultPublisher(cast(Redis, redis), queue=GROUP_RESULT_QUEUE_KEY, clock=lambda: NOW)
    publisher.publish(ResultType.QUESTION_SPOKEN, 55, {"seq": 6})

    assert RESULT_QUEUE_KEY not in redis.lists
    assert [json.loads(raw)["type"] for raw in redis.lists[GROUP_RESULT_QUEUE_KEY]] == [
        "question.spoken"
    ]


# 기준: AI 명세 6.7(그룹 배정 거절은 sessionId 없이 groupId를 담는다)
def test_group_rejection_has_group_id_instead_of_session_id() -> None:
    redis = FakeRedis()

    make(redis).publish_group_rejection(12, {"reason": "INVALID_ASSIGNMENT"})

    assert pushed(redis) == [
        {
            "type": "assignment.rejected",
            "groupId": 12,
            "reason": "INVALID_ASSIGNMENT",
            "occurredAt": "2026-10-22T14:03:12.987+09:00",
        }
    ]


def test_group_rejection_needs_reason() -> None:
    redis = FakeRedis()

    with pytest.raises(ValueError, match="reason"):
        make(redis).publish_group_rejection(12, {})

    assert redis.calls == 0
