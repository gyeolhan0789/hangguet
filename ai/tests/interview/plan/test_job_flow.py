"""BE가 작업 큐에 LPUSH한 PLAN 메시지가 처리 함수를 거쳐 결과 큐의 결과 메시지가 된다."""

import json
from datetime import UTC, datetime
from typing import Any, cast

from redis import ConnectionError as RedisConnectionError
from redis import Redis

from app.common.results import KST, RESULT_QUEUE_KEY, ResultPublisher
from app.interview.plan.job import PlanJobHandler, register_plan_handler
from app.worker.dispatch import Dispatcher
from app.worker.queue import PROCESSING_KEY, QUEUE_KEY, ReceiveResult, RedisJobQueue
from tests.interview.plan.fakes import JOB, JOB_ID, FakeChat
from tests.interview.plan.test_job import CLAIMS, QUESTIONS
from tests.worker.test_queue import FakeListRedis

# 실제 시계로 마감을 확인하는 처리 함수를 실행하므로 요청 시각은 시험을 시작한 시각이다
REQUESTED_AT = datetime.now(UTC).isoformat()
NOW = datetime(2026, 10, 22, 14, 3, 12, tzinfo=KST)
PLAN = json.dumps(
    {
        "jobType": "PLAN",
        "requestedAt": REQUESTED_AT,
        "jobId": JOB_ID,
        "sessionId": 55,
        "companyName": JOB.company_name,
        "jobTitle": JOB.job_title,
        "coverLetter": JOB.cover_letter,
    },
    ensure_ascii=False,
)


class ResultQueueDownRedis(FakeListRedis):
    """작업 큐는 동작하고 결과 큐 추가만 실패하는 대역."""

    def lpush(self, key: str, *values: str) -> int:
        if key == RESULT_QUEUE_KEY:
            raise RedisConnectionError("연결 중단")
        return super().lpush(key, *values)


def make_queue(redis: FakeListRedis, chat: FakeChat) -> RedisJobQueue:
    client = cast(Redis, redis)
    results = ResultPublisher(client, sleep=lambda seconds: None, clock=lambda: NOW)
    dispatcher = Dispatcher()
    register_plan_handler(dispatcher, PlanJobHandler(results, chat))
    return RedisJobQueue(client, dispatcher, results, block_timeout=1)


def results(redis: FakeListRedis) -> list[dict[str, Any]]:
    return [json.loads(raw) for raw in reversed(redis.items(RESULT_QUEUE_KEY))]


def test_plan_message_ends_with_completed_result_and_no_job() -> None:
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, PLAN)
    chat = FakeChat([CLAIMS, QUESTIONS])

    assert make_queue(redis, chat).receive_once() is ReceiveResult.HANDLED

    assert [(m["type"], m["jobId"]) for m in results(redis)] == [
        ("plan.progress", JOB_ID),
        ("plan.completed", JOB_ID),
    ]
    # 작업 메시지의 자소서가 그대로 GMS 요청에 전달된다
    assert "[4] 주문 조회 API의 응답 시간을 40% 줄였습니다." in chat.calls[0][1]["content"]
    assert redis.items(PROCESSING_KEY) == []


def test_failed_generation_ends_with_failed_result_and_removes_job() -> None:
    """재시도 후 실패는 plan.failed로 끝난 처리이므로 작업을 삭제한다."""
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, PLAN)

    result = make_queue(redis, FakeChat([{"claims": []}, {"claims": []}])).receive_once()

    assert result is ReceiveResult.HANDLED
    assert [(m["type"], m["reason"]) for m in results(redis)] == [("plan.failed", "INVALID_OUTPUT")]
    assert redis.items(PROCESSING_KEY) == []


def test_result_queue_failure_keeps_job_in_processing() -> None:
    """결과를 전송하지 못한 작업은 처리 중 리스트에 남아 작업자를 다시 시작할 때 처리된다."""
    redis = ResultQueueDownRedis()
    redis.lpush(QUEUE_KEY, PLAN)

    result = make_queue(redis, FakeChat([CLAIMS, QUESTIONS])).receive_once()

    assert result is ReceiveResult.FAILED
    assert redis.items(PROCESSING_KEY) == [PLAN]
