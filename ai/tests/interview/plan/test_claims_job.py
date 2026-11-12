import json
import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any, cast

import pytest
from redis import ConnectionError as RedisConnectionError
from redis import Redis

from app.common.gms import GmsUnavailableError
from app.common.results import KST, RESULT_QUEUE_KEY, ResultPublisher, ResultPublishError
from app.common.versions import REGISTRY, VersionKind
from app.interview.plan.claims_job import (
    PROMPT_VERSION,
    ExtractClaimsJobHandler,
    register_extract_claims_handler,
)
from app.interview.plan.job import PLAN_TIMEOUT_SECONDS
from app.worker.dispatch import Dispatcher, DispatchResult
from app.worker.messages import ExtractClaimsJob
from tests.common.test_results import FakeRedis
from tests.interview.plan.fakes import JOB, JOB_ID, FakeChat

NOW = datetime(2026, 10, 22, 14, 3, 12, tzinfo=KST)
# 질문 생성 테스트(JOB)와 같은 지원서 내용을 지원서 단위 작업으로 전달한다
EXTRACT_JOB = ExtractClaimsJob(
    job_id=JOB_ID,
    application_id=7,
    requested_at=JOB.requested_at,
    company_name=JOB.company_name,
    job_title=JOB.job_title,
    cover_letter_items=JOB.cover_letter_items,
)
CLAIMS = {
    "claims": [
        {
            "text": "주문 조회 응답 시간을 40% 줄였다",
            "type": "NUMBER",
            "sentenceNo": 4,
            "talentCriteria": ["실행·성과"],
        },
        {
            "text": "캐시 계층을 설계했다",
            "type": "EXPERIENCE",
            "sentenceNo": 5,
            "talentCriteria": ["전문성·성장"],
        },
    ]
}
BROKEN_CLAIMS: dict[str, Any] = {"claims": []}


def make(
    chat: Any,
    redis: FakeRedis | None = None,
    *,
    clock: Callable[[], float] = lambda: EXTRACT_JOB.requested_at.timestamp(),
) -> tuple[ExtractClaimsJobHandler, FakeRedis]:
    store = redis or FakeRedis()
    results = ResultPublisher(cast(Redis, store), sleep=lambda seconds: None, clock=lambda: NOW)
    return ExtractClaimsJobHandler(results, chat, clock=clock), store


def pushed(redis: FakeRedis) -> list[dict[str, Any]]:
    """BE가 BLMOVE ... RIGHT로 꺼내는 순서(오래된 것부터)로 반환한다."""
    return [json.loads(raw) for raw in reversed(redis.lists.get(RESULT_QUEUE_KEY, []))]


def common(result_type: str) -> dict[str, Any]:
    # 지원서 단위 작업이므로 sessionId 대신 applicationId를 담는다(AI 명세 1.3)
    return {
        "type": result_type,
        "applicationId": 7,
        "jobId": JOB_ID,
        "occurredAt": "2026-10-22T14:03:12.000+09:00",
    }


def test_publishes_extracted_claims_with_versions() -> None:
    run, redis = make(FakeChat([CLAIMS]))

    run(EXTRACT_JOB)

    assert pushed(redis) == [
        {
            **common("claims.extracted"),
            "claims": [
                {
                    "id": "c1",
                    "text": "주문 조회 응답 시간을 40% 줄였다",
                    "type": "NUMBER",
                    "sentenceNo": 4,
                    "talentCriteria": ["실행·성과"],
                },
                {
                    "id": "c2",
                    "text": "캐시 계층을 설계했다",
                    "type": "EXPERIENCE",
                    "sentenceNo": 5,
                    "talentCriteria": ["전문성·성장"],
                },
            ],
            "promptVersion": "extract-claims-v1",
            "modelVersion": "gms-served",
        }
    ]


def test_claim_with_number_missing_from_its_sentence_is_dropped() -> None:
    """근거 검사를 통과한 주장만 담는다(AI 명세 2장).

    근거 문장에 없는 수치를 전제로 질문하지 않기 위함이다.
    """
    claims = {
        "claims": [
            {
                "text": "주문 조회 응답 시간을 50% 줄였다",
                "type": "NUMBER",
                "sentenceNo": 4,
                "talentCriteria": ["실행·성과"],
            },
            {
                "text": "캐시 계층을 설계했다",
                "type": "EXPERIENCE",
                "sentenceNo": 5,
                "talentCriteria": ["전문성·성장"],
            },
        ]
    }
    run, redis = make(FakeChat([claims]))

    run(EXTRACT_JOB)

    assert [c["text"] for c in pushed(redis)[0]["claims"]] == ["캐시 계층을 설계했다"]


def test_broken_output_after_retry_publishes_invalid_output() -> None:
    chat = FakeChat([BROKEN_CLAIMS, BROKEN_CLAIMS])
    run, redis = make(chat)

    run(EXTRACT_JOB)

    assert len(chat.calls) == 2
    assert pushed(redis) == [{**common("claims.extractFailed"), "reason": "INVALID_OUTPUT"}]


def test_unavailable_gms_publishes_gms_unavailable(caplog: pytest.LogCaptureFixture) -> None:
    run, redis = make(FakeChat([GmsUnavailableError("503")]))

    with caplog.at_level(logging.ERROR, logger="app.interview.plan.claims_job"):
        run(EXTRACT_JOB)

    assert pushed(redis) == [{**common("claims.extractFailed"), "reason": "GMS_UNAVAILABLE"}]
    assert "applicationId=7" in caplog.text
    # 자소서 내용은 개인 정보이므로 실패 로그에 포함하지 않는다
    assert "주문 조회" not in caplog.text


def test_unexpected_error_publishes_internal_error(caplog: pytest.LogCaptureFixture) -> None:
    run, redis = make(FakeChat([RuntimeError("unexpected")]))

    with caplog.at_level(logging.ERROR, logger="app.interview.plan.claims_job"):
        run(EXTRACT_JOB)

    assert pushed(redis) == [{**common("claims.extractFailed"), "reason": "INTERNAL_ERROR"}]
    assert caplog.records[0].exc_info is not None


def test_publishes_timed_out_after_be_wait_limit() -> None:
    """BE가 요청한 시각부터 3분이 지나면 GMS를 호출하지 않는다(AI 명세 5장).

    큐에서 대기한 시간도 포함한다.
    """
    chat = FakeChat([CLAIMS])
    run, redis = make(
        chat, clock=lambda: EXTRACT_JOB.requested_at.timestamp() + PLAN_TIMEOUT_SECONDS + 1
    )

    run(EXTRACT_JOB)

    assert chat.calls == []
    assert pushed(redis) == [{**common("claims.extractFailed"), "reason": "TIMED_OUT"}]


class DownRedis(FakeRedis):
    def lpush(self, key: str, *values: str) -> int:
        raise RedisConnectionError("연결 중단")


@pytest.mark.parametrize("outcomes", [[CLAIMS], [BROKEN_CLAIMS, BROKEN_CLAIMS]])
def test_result_publish_failure_is_raised(outcomes: list[Any]) -> None:
    """작업이 처리 중 리스트에 남아 다시 처리되도록 분배기까지 예외를 전파한다."""
    run, _ = make(FakeChat(outcomes), DownRedis())

    with pytest.raises(ResultPublishError):
        run(EXTRACT_JOB)


def test_registered_as_extract_claims_handler() -> None:
    dispatcher = Dispatcher()
    run, redis = make(FakeChat([CLAIMS]))

    register_extract_claims_handler(dispatcher, run)

    assert dispatcher.dispatch(EXTRACT_JOB) is DispatchResult.HANDLED
    assert pushed(redis)[0]["type"] == "claims.extracted"


def test_prompt_version_is_registered() -> None:
    assert REGISTRY.require(VersionKind.PROMPT, PROMPT_VERSION) == "extract-claims-v1"
