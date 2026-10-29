import json
import threading
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from redis import Redis

from app.common.cover_letter import CoverLetterItem
from app.interview.cover_letter import CoverLetterCheckError
from app.worker.checks import (
    CHECK_QUEUE_KEY,
    RESULT_TTL_SECONDS,
    CoverLetterCheckWorker,
    result_key,
)

# 기준: AI 명세 2.1 자기소개서 검증(전용 큐 ai:checks, 결과는 ai:checks:result:{jobId}, BE 대기 8초)

NOW = datetime(2026, 10, 27, 15, 0, 0, tzinfo=UTC).timestamp()


class FakeRedis:
    """검증 작업자가 쓰는 명령만 구현한 대역. 대기는 하지 않는다."""

    def __init__(self, *messages: str) -> None:
        self.lists: dict[str, list[str]] = {CHECK_QUEUE_KEY: list(messages)}
        self.ttl: dict[str, int] = {}

    def brpop(self, keys: list[str], timeout: int) -> tuple[str, str] | None:
        items = self.lists.get(keys[0], [])
        return (keys[0], items.pop()) if items else None

    def pipeline(self) -> "FakeRedis":
        return self

    def lpush(self, key: str, value: str) -> None:
        self.lists.setdefault(key, []).insert(0, value)

    def expire(self, key: str, seconds: int) -> None:
        self.ttl[key] = seconds

    def execute(self) -> None:
        pass


def message(**overrides: Any) -> str:
    body = {
        "jobId": "c1",
        "requestedAt": "2026-10-28T00:00:00+09:00",
        "companyName": "○○전자",
        "jobTitle": "백엔드",
        "coverLetterItems": [
            {"question": "지원 동기", "answer": "저는 …"},
            {"question": "협업 경험", "answer": "함께 …"},
        ],
    }
    body.update(overrides)
    return json.dumps(body)


def run(redis: FakeRedis, check: Any) -> list[Any]:
    worker = CoverLetterCheckWorker(
        cast(Redis, redis), check, threading.Event(), now=lambda: NOW + 1
    )
    worker.receive_once()
    return [json.loads(v) for v in redis.lists.get(result_key("c1"), [])]


def test_result_goes_to_the_job_result_key_and_expires() -> None:
    seen: list[tuple[str, str, tuple[CoverLetterItem, ...]]] = []

    def check(company: str, job: str, items: tuple[CoverLetterItem, ...]) -> bool:
        seen.append((company, job, items))
        return False

    redis = FakeRedis(message())
    assert run(redis, check) == [{"usable": False}]
    # 문항은 받은 순서 그대로 판단에 넘긴다
    assert seen == [
        (
            "○○전자",
            "백엔드",
            (CoverLetterItem("지원 동기", "저는 …"), CoverLetterItem("협업 경험", "함께 …")),
        )
    ]
    assert redis.ttl[result_key("c1")] == RESULT_TTL_SECONDS


def test_legacy_cover_letter_is_checked_as_first_item() -> None:
    """AI 명세 1.3: 이전 BE 메시지의 coverLetter(글 하나)는 질문 '자기소개서'인 1번 문항이다."""
    seen: list[tuple[CoverLetterItem, ...]] = []

    def check(company: str, job: str, items: tuple[CoverLetterItem, ...]) -> bool:
        seen.append(items)
        return True

    body = json.loads(message(coverLetter="저는 …"))
    del body["coverLetterItems"]

    assert run(FakeRedis(json.dumps(body)), check) == [{"usable": True}]
    assert seen == [(CoverLetterItem("자기소개서", "저는 …"),)]


def test_jev_failure_or_missing_key_is_check_failed() -> None:
    def fail(company: str, job: str, items: tuple[CoverLetterItem, ...]) -> bool:
        raise CoverLetterCheckError("timeout")

    assert run(FakeRedis(message()), fail) == [{"error": "CHECK_FAILED"}]
    assert run(FakeRedis(message()), None) == [{"error": "CHECK_FAILED"}]


@pytest.mark.parametrize(
    "overrides",
    [
        {"companyName": None},
        {"jobTitle": 7},
        {"coverLetterItems": None},
        {"coverLetterItems": []},
        {"coverLetterItems": [{"question": "지원 동기", "answer": " "}]},
        {"coverLetterItems": "저는 …"},
    ],
    ids=[
        "companyName-None",
        "jobTitle-number",
        "items-None",
        "items-empty",
        "items-blank-answer",
        "items-string",
    ],
)
def test_malformed_message_is_check_failed(overrides: dict[str, Any]) -> None:
    called: list[bool] = []

    def check(*args: object) -> bool:
        called.append(True)
        return True

    assert run(FakeRedis(message(**overrides)), check) == [{"error": "CHECK_FAILED"}]
    assert called == []


def test_jobs_the_be_gave_up_on_or_without_id_are_dropped() -> None:
    called: list[bool] = []

    def check(*args: object) -> bool:
        called.append(True)
        return True

    # BE 대기(8초)보다 오래된 요청
    old = FakeRedis(message(requestedAt="2026-10-27T23:59:50+09:00"))
    assert run(old, check) == []
    redis = FakeRedis(message(jobId=None), "not json")
    run(redis, check)
    run(redis, check)
    assert called == [] and set(redis.lists) == {CHECK_QUEUE_KEY}


def test_empty_queue_does_nothing() -> None:
    assert run(FakeRedis(), lambda *a: True) == []


def test_unexpected_error_waits_before_receiving_again() -> None:
    waits: list[float | None] = []

    class Stop(threading.Event):
        def wait(self, timeout: float | None = None) -> bool:
            waits.append(timeout)
            self.set()
            return True

    class Broken:
        def brpop(self, keys: list[str], timeout: int) -> None:
            raise AttributeError("broken")

    CoverLetterCheckWorker(cast(Redis, Broken()), None, Stop(), retry_seconds=5.0).run()
    assert waits == [5.0]
