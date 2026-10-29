import json
import logging
from typing import Any, cast

import pytest
from redis import ConnectionError as RedisConnectionError
from redis import Redis

from app.common.cover_letter import CoverLetterItem
from app.common.redis import SOCKET_TIMEOUT_SECONDS
from app.common.results import RESULT_QUEUE_KEY, ResultPublisher
from app.common.settings import SettingsError
from app.worker.dispatch import Dispatcher
from app.worker.messages import EvaluateJob, Job, PlanJob, ScoreAnswerJob
from app.worker.queue import (
    BLOCK_TIMEOUT_SECONDS,
    PROCESSING_KEY,
    QUEUE_KEY,
    ReceiveResult,
    RedisJobQueue,
    WorkerQueue,
    worker_queue,
)

JOB_1 = "8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34"
JOB_2 = "0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f70"
JOB_3 = "11111111-2222-4333-8444-555555555555"

ANSWER = {
    "seq": 1,
    "question": "응답 시간을 40% 줄인 과정은?",
    "criteria": "원인 분석 · 수치 근거",
    "content": "조회 쿼리 실행 계획을 보고…",
}
CONTENT: dict[str, dict[str, Any]] = {
    "PLAN": {
        "companyName": "한끗전자",
        "jobTitle": "백엔드 개발",
        "coverLetterItems": [{"question": "지원 동기", "answer": "자소서 원문"}],
    },
    "SCORE_ANSWER": {"answerId": 903, "mode": "CHAT", **ANSWER},
    "EVALUATE": {
        "mode": "CHAT",
        "coverLetterItems": [{"question": "지원 동기", "answer": "자소서 원문"}],
        "claims": [],
        "answers": [{"answerId": 903, **ANSWER, "evaluation": None}],
    },
}


def backend_message(job_type: str, job_id: str, session_id: int) -> str:
    """AI 명세 1.3 형식의 작업 메시지 원문을 생성한다.

    작업 내용은 작업 종류별 예시 값이다.
    """
    message = {
        "jobType": job_type,
        "jobId": job_id,
        "sessionId": session_id,
        "requestedAt": "2026-10-22T14:03:13+09:00",
    }
    return json.dumps({**message, **CONTENT[job_type]}, ensure_ascii=False)


SCORE = backend_message("SCORE_ANSWER", JOB_1, 55)
EVALUATE = backend_message("EVALUATE", JOB_2, 55)


class FakeListRedis:
    """작업자가 사용하는 Redis List 명령만 같은 의미로 구현한 대역.

    대기는 하지 않는다.
    """

    def __init__(self) -> None:
        self.lists: dict[str, list[str]] = {}
        self.timeouts: list[int] = []

    def lpush(self, key: str, *values: str) -> int:
        items = self.lists.setdefault(key, [])
        for value in values:
            items.insert(0, value)
        return len(items)

    def _pop(self, key: str, side: str) -> str | None:
        items = self.lists.get(key)
        if not items:
            return None
        return items.pop(0) if side == "LEFT" else items.pop()

    def _push(self, key: str, side: str, value: str) -> None:
        items = self.lists.setdefault(key, [])
        if side == "LEFT":
            items.insert(0, value)
        else:
            items.append(value)

    def lmove(self, src: str, dst: str, wherefrom: str, whereto: str) -> str | None:
        value = self._pop(src, wherefrom)
        if value is not None:
            self._push(dst, whereto, value)
        return value

    def blmove(self, src: str, dst: str, timeout: int, wherefrom: str, whereto: str) -> str | None:
        self.timeouts.append(timeout)
        return self.lmove(src, dst, wherefrom, whereto)

    def lrem(self, key: str, count: int, value: str) -> int:
        # Redis와 같이 count>0은 왼쪽부터, count<0은 오른쪽부터 그 수만큼 삭제하고
        # 0은 같은 값을 모두 삭제한다
        items = self.lists.get(key, [])
        limit = abs(count) or len(items)
        order = range(len(items) - 1, -1, -1) if count < 0 else range(len(items))
        targets = [i for i in order if items[i] == value][:limit]
        for i in sorted(targets, reverse=True):
            items.pop(i)
        return len(targets)

    def items(self, key: str) -> list[str]:
        return list(self.lists.get(key, []))


def make_queue(
    redis: FakeListRedis,
    handlers: dict[type[Job], list[Job]] | None = None,
    *,
    fail: bool = False,
    queue: WorkerQueue = WorkerQueue.DEFAULT,
) -> RedisJobQueue:
    dispatcher = Dispatcher()
    for job_class, received in (handlers or {}).items():

        def handle(job: Job, received: list[Job] = received) -> None:
            if fail:
                raise RuntimeError("GMS 호출 실패")
            received.append(job)

        dispatcher.register(job_class, handle)
    results = ResultPublisher(cast(Redis, redis), sleep=lambda seconds: None)
    return RedisJobQueue(cast(Redis, redis), dispatcher, results, queue=queue, block_timeout=1)


def test_handled_job_is_removed_from_processing() -> None:
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, SCORE)
    received: list[Job] = []

    result = make_queue(redis, {ScoreAnswerJob: received}).receive_once()

    assert result is ReceiveResult.HANDLED
    [job] = received
    assert isinstance(job, ScoreAnswerJob)
    assert (job.job_id, job.session_id, job.answer_id) == (JOB_1, 55, 903)
    assert redis.items(QUEUE_KEY) == []
    assert redis.items(PROCESSING_KEY) == []


def test_receives_oldest_job_first() -> None:
    """BE가 LPUSH하므로 오른쪽 끝이 가장 먼저 추가된 작업이다."""
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, SCORE)
    redis.lpush(QUEUE_KEY, EVALUATE)
    received: list[Job] = []
    queue = make_queue(redis, {ScoreAnswerJob: received, EvaluateJob: received})

    queue.receive_once()
    queue.receive_once()

    assert [job.job_id for job in received] == [JOB_1, JOB_2]


def test_passes_job_content_to_handler() -> None:
    """AI가 DB를 읽지 않으므로 처리 함수는 작업 메시지에 담긴 내용으로 처리한다."""
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, EVALUATE)
    received: list[Job] = []

    make_queue(redis, {EvaluateJob: received}).receive_once()

    [job] = received
    assert isinstance(job, EvaluateJob)
    assert job.cover_letter_items == (CoverLetterItem("지원 동기", "자소서 원문"),)
    assert [a.answer_id for a in job.answers] == [903]


def test_invalid_job_is_removed(caplog: pytest.LogCaptureFixture) -> None:
    """형식이 틀린 작업은 다시 수신해도 처리할 수 없으므로 처리 중 리스트에서 삭제한다."""
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, '{"jobType":"PLAN","jobId":"x","sessionId":55}')

    with caplog.at_level(logging.ERROR, logger="app.worker.queue"):
        result = make_queue(redis).receive_once()

    assert result is ReceiveResult.INVALID
    assert redis.items(PROCESSING_KEY) == []
    assert "jobId" in caplog.records[0].getMessage()


def test_invalid_job_log_excludes_job_content(caplog: pytest.LogCaptureFixture) -> None:
    """원문에는 자소서·답변 글이 있으므로 로그에는 jobId와 오류 위치만 남긴다."""
    raw = json.dumps(
        {
            "jobType": "PLAN",
            "jobId": JOB_1,
            "sessionId": 55,
            "requestedAt": "2026-10-22T14:03:13+09:00",
            "coverLetterItems": [{"question": "지원 동기", "answer": "비밀 자소서"}],
        },
        ensure_ascii=False,
    )
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, raw)

    with caplog.at_level(logging.ERROR, logger="app.worker.queue"):
        result = make_queue(redis).receive_once()

    assert result is ReceiveResult.INVALID
    message = caplog.records[0].getMessage()
    assert "비밀 자소서" not in message
    assert JOB_1 in message
    assert "companyName" in message


@pytest.mark.parametrize(
    "items",
    [
        [{"question": "비밀 문항", "answer": " "}],
        [["비밀 자소서"]],
    ],
)
def test_invalid_cover_letter_items_log_excludes_job_content(
    items: list[Any], caplog: pytest.LogCaptureFixture
) -> None:
    """회사·직무가 맞고 문항만 틀려도 로그에는 문항 위치만 남기고 문항 글은 남기지 않는다."""
    raw = json.dumps(
        {
            "jobType": "PLAN",
            "jobId": JOB_1,
            "sessionId": 55,
            "requestedAt": "2026-10-22T14:03:13+09:00",
            "companyName": "한끗전자",
            "jobTitle": "백엔드 개발",
            "coverLetterItems": items,
        },
        ensure_ascii=False,
    )
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, raw)

    with caplog.at_level(logging.ERROR, logger="app.worker.queue"):
        result = make_queue(redis).receive_once()

    assert result is ReceiveResult.INVALID
    message = caplog.records[0].getMessage()
    assert "비밀" not in message
    assert JOB_1 in message
    assert "coverLetterItems[0]" in message


@pytest.mark.parametrize("raw", ["{", "[1]", '{"jobId": 7}'])
def test_invalid_job_without_job_id_is_removed(raw: str, caplog: pytest.LogCaptureFixture) -> None:
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, raw)

    with caplog.at_level(logging.ERROR, logger="app.worker.queue"):
        assert make_queue(redis).receive_once() is ReceiveResult.INVALID

    assert redis.items(PROCESSING_KEY) == []
    assert "jobId=None" in caplog.records[0].getMessage()


def test_long_job_id_is_truncated_in_log(caplog: pytest.LogCaptureFixture) -> None:
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, json.dumps({"jobType": "PLAN", "jobId": "a" * 300}))

    with caplog.at_level(logging.ERROR, logger="app.worker.queue"):
        make_queue(redis).receive_once()

    message = caplog.records[0].getMessage()
    assert "a" * 36 in message
    assert "a" * 37 not in message


def published(redis: FakeListRedis) -> list[dict[str, Any]]:
    return [json.loads(raw) for raw in reversed(redis.items(RESULT_QUEUE_KEY))]


@pytest.mark.parametrize(
    ("job_type", "failed_type"),
    [
        ("PLAN", "plan.failed"),
        ("EVALUATE", "evaluation.failed"),
        ("MERGE_RECORDING", "recording.mergeFailed"),
    ],
)
def test_invalid_job_with_common_fields_sends_failed_result(
    job_type: str, failed_type: str
) -> None:
    """화면이 BE 최대 대기 시간까지 대기하지 않도록 INVALID_JOB을 전송한다(AI 명세 1.3)."""
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, json.dumps({"jobType": job_type, "jobId": JOB_1, "sessionId": 55}))

    assert make_queue(redis).receive_once() is ReceiveResult.INVALID

    [message] = published(redis)
    assert {k: message[k] for k in ("type", "sessionId", "jobId", "reason")} == {
        "type": failed_type,
        "sessionId": 55,
        "jobId": JOB_1,
        "reason": "INVALID_JOB",
    }
    assert redis.items(PROCESSING_KEY) == []


def test_invalid_score_answer_sends_no_result() -> None:
    """SCORE_ANSWER는 실패 결과가 없고 결과 생성이 다시 채점한다(AI 명세 5장)."""
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, json.dumps({"jobType": "SCORE_ANSWER", "jobId": JOB_1, "sessionId": 55}))

    assert make_queue(redis).receive_once() is ReceiveResult.INVALID

    assert published(redis) == []
    assert redis.items(PROCESSING_KEY) == []


class ResultQueueDownRedis(FakeListRedis):
    def lpush(self, key: str, *values: str) -> int:
        if key == RESULT_QUEUE_KEY:
            raise RedisConnectionError("연결 중단")
        return super().lpush(key, *values)


def test_invalid_job_stays_when_failed_result_cannot_be_sent() -> None:
    """실패 결과를 전송하지 못하면 작업을 남겨 다시 시작할 때 전송한다(AI 명세 5장)."""
    redis = ResultQueueDownRedis()
    raw = json.dumps({"jobType": "PLAN", "jobId": JOB_1, "sessionId": 55})
    redis.lpush(QUEUE_KEY, raw)

    assert make_queue(redis).receive_once() is ReceiveResult.FAILED

    assert redis.items(PROCESSING_KEY) == [raw]


def test_job_without_handler_stays_in_processing() -> None:
    """처리 함수가 배포되지 않은 종류의 작업을 유실하지 않는다."""
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, EVALUATE)

    result = make_queue(redis, {ScoreAnswerJob: []}).receive_once()

    assert result is ReceiveResult.NO_HANDLER
    assert redis.items(PROCESSING_KEY) == [EVALUATE]
    assert redis.items(QUEUE_KEY) == []


def test_failed_job_stays_in_processing() -> None:
    """실패한 작업을 즉시 되돌리지 않아 같은 실패가 빠르게 반복되지 않는다."""
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, SCORE)

    result = make_queue(redis, {ScoreAnswerJob: []}, fail=True).receive_once()

    assert result is ReceiveResult.FAILED
    assert redis.items(PROCESSING_KEY) == [SCORE]
    assert redis.items(QUEUE_KEY) == []


def test_empty_queue_returns_empty_after_timeout() -> None:
    redis = FakeListRedis()

    assert make_queue(redis).receive_once() is ReceiveResult.EMPTY
    assert redis.timeouts == [1]


def test_block_timeout_is_shorter_than_socket_timeout() -> None:
    """BLMOVE 대기가 클라이언트 읽기 시간 초과보다 먼저 끝나야 빈 큐에서 EMPTY를 반환한다."""
    assert BLOCK_TIMEOUT_SECONDS < SOCKET_TIMEOUT_SECONDS


def test_removes_only_received_copy_of_duplicate_message() -> None:
    """Outbox 재발행으로 같은 원문이 두 번 있어도 처리한 1건만 삭제한다."""
    redis = FakeListRedis()
    redis.lists[PROCESSING_KEY] = [SCORE]
    redis.lpush(QUEUE_KEY, SCORE)

    make_queue(redis, {ScoreAnswerJob: []}).receive_once()

    assert redis.items(PROCESSING_KEY) == [SCORE]


def test_recover_moves_processing_back_in_received_order() -> None:
    """먼저 수신했던 작업이 다시 먼저 처리되도록 ai:jobs에서 먼저 수신되는 쪽으로 되돌린다."""
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, SCORE)
    redis.lpush(QUEUE_KEY, EVALUATE)
    stalled = make_queue(redis, {ScoreAnswerJob: [], EvaluateJob: []}, fail=True)
    stalled.receive_once()
    stalled.receive_once()
    newer = backend_message("PLAN", JOB_3, 56)
    redis.lpush(QUEUE_KEY, newer)
    received: list[Job] = []
    queue = make_queue(redis, {ScoreAnswerJob: received, EvaluateJob: received, PlanJob: received})

    assert queue.recover() == 2
    assert redis.items(PROCESSING_KEY) == []
    for _ in range(3):
        queue.receive_once()

    assert [job.job_id for job in received] == [JOB_1, JOB_2, JOB_3]


def test_recover_with_empty_processing_moves_nothing() -> None:
    redis = FakeListRedis()
    redis.lpush(QUEUE_KEY, SCORE)

    assert make_queue(redis).recover() == 0
    assert redis.items(QUEUE_KEY) == [SCORE]


def test_worker_queue_keys_match_spec() -> None:
    """큐 이름은 BE가 LPUSH하는 이름과 같아야 하므로 AI 명세 1.3의 표와 그대로 맞춘다."""
    assert {queue.value: (queue.key, queue.processing_key) for queue in WorkerQueue} == {
        "default": ("ai:jobs", "ai:jobs:processing"),
        "plan": ("ai:jobs:plan", "ai:jobs:plan:processing"),
        "recording": ("ai:jobs:recording", "ai:jobs:recording:processing"),
    }


@pytest.mark.parametrize("queue", list(WorkerQueue))
def test_receives_only_from_own_queue(queue: WorkerQueue) -> None:
    redis = FakeListRedis()
    for other in WorkerQueue:
        redis.lpush(other.key, SCORE)
    received: list[Job] = []

    result = make_queue(redis, {ScoreAnswerJob: received}, queue=queue).receive_once()

    assert result is ReceiveResult.HANDLED
    assert len(received) == 1
    assert redis.items(queue.key) == []
    assert redis.items(queue.processing_key) == []
    for other in WorkerQueue:
        if other is not queue:
            assert redis.items(other.key) == [SCORE]


def test_job_without_handler_stays_in_own_processing() -> None:
    redis = FakeListRedis()
    redis.lpush(WorkerQueue.PLAN.key, SCORE)

    result = make_queue(redis, queue=WorkerQueue.PLAN).receive_once()

    assert result is ReceiveResult.NO_HANDLER
    assert redis.items(WorkerQueue.PLAN.processing_key) == [SCORE]
    assert redis.items(PROCESSING_KEY) == []


def test_recover_moves_only_own_processing() -> None:
    """같은 Redis를 쓰는 다른 큐 작업자가 처리 중인 작업은 되돌리지 않는다."""
    redis = FakeListRedis()
    redis.lpush(WorkerQueue.PLAN.processing_key, EVALUATE)
    redis.lpush(PROCESSING_KEY, SCORE)

    assert make_queue(redis, queue=WorkerQueue.PLAN).recover() == 1
    assert redis.items(WorkerQueue.PLAN.key) == [EVALUATE]
    assert redis.items(PROCESSING_KEY) == [SCORE]
    assert redis.items(QUEUE_KEY) == []


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        (None, WorkerQueue.DEFAULT),
        ("default", WorkerQueue.DEFAULT),
        ("plan", WorkerQueue.PLAN),
        ("recording", WorkerQueue.RECORDING),
    ],
)
def test_worker_queue_from_setting(name: str | None, expected: WorkerQueue) -> None:
    assert worker_queue(name) is expected


@pytest.mark.parametrize("name", ["plans", "PLAN", "ai:jobs:plan"])
def test_unknown_worker_queue_fails_with_variable_name(name: str) -> None:
    with pytest.raises(SettingsError) as raised:
        worker_queue(name)

    assert "AI_WORKER_QUEUE" in str(raised.value)
    assert name not in str(raised.value)
