import json
import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from datetime import datetime
from typing import Any, cast

import pytest
from redis import ConnectionError as RedisConnectionError
from redis import Redis

from app.common.gms import GmsClient, GmsResult, GmsUnavailableError
from app.common.results import KST, RESULT_QUEUE_KEY, ResultPublisher, ResultPublishError
from app.common.settings import SettingsError, load_settings
from app.common.versions import REGISTRY, VersionKind
from app.interview.plan.job import (
    PLAN_TIMEOUT_SECONDS,
    PROMPT_VERSION,
    PlanJobHandler,
    gms_plan_chat,
    question_json,
    register_plan_handler,
)
from app.interview.plan.questions import Question, build_question_messages
from app.worker.dispatch import Dispatcher, DispatchResult
from app.worker.main import lazy_gms_client
from app.worker.messages import Claim, ClaimType
from tests.common.test_results import FakeRedis
from tests.interview.plan.fakes import JOB, JOB_ID, FakeChat, question

NOW = datetime(2026, 10, 22, 14, 3, 12, tzinfo=KST)
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
QUESTIONS = {
    "questions": [question(seq, "c2" if seq % 2 == 0 else "c1") for seq in range(1, 6)],
}
BROKEN_CLAIMS: dict[str, Any] = {"claims": []}
FOUR_QUESTIONS = {"questions": [question(seq) for seq in range(1, 5)]}


def make(
    chat: Any,
    redis: FakeRedis | None = None,
    *,
    clock: Callable[[], float] = lambda: JOB.requested_at.timestamp(),
) -> tuple[PlanJobHandler, FakeRedis]:
    store = redis or FakeRedis()
    results = ResultPublisher(cast(Redis, store), sleep=lambda seconds: None, clock=lambda: NOW)
    return PlanJobHandler(results, chat, clock=clock), store


def pushed(redis: FakeRedis) -> list[dict[str, Any]]:
    """BE가 BLMOVE ... RIGHT로 꺼내는 순서(오래된 것부터)로 반환한다."""
    return [json.loads(raw) for raw in reversed(redis.lists.get(RESULT_QUEUE_KEY, []))]


def common(result_type: str) -> dict[str, Any]:
    return {
        "type": result_type,
        "sessionId": 55,
        "jobId": JOB_ID,
        "occurredAt": "2026-10-22T14:03:12.000+09:00",
    }


def test_publishes_progress_then_completed_plan() -> None:
    run, redis = make(FakeChat([CLAIMS, QUESTIONS]))

    run(JOB)

    assert pushed(redis) == [
        {**common("plan.progress"), "progress": 50},
        {
            **common("plan.completed"),
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
            "questions": [
                {
                    "seq": seq,
                    "content": f"{seq}번 질문의 근거는 무엇인가?",
                    "criteria": "원인 분석 · 수치 근거",
                    "claimId": "c2" if seq % 2 == 0 else "c1",
                    "companyItem": None,
                }
                for seq in range(1, 6)
            ],
            "promptVersion": "plan-v8",
            "modelVersion": "gms-served",
        },
    ]


def test_completed_plan_has_linked_company_item_as_card_entry() -> None:
    """질문에 연결한 회사 항목은 카드 칸 이름과 카드 항목의 칸을 그대로 담는다(AI 명세 2장)."""
    entry = {
        "summary": "해외 결제 확대",
        "quote": "해외 결제 서비스를 확대할 계획이다",
        "source": "사업보고서",
        "ncs_subcategories": ["응용SW엔지니어링"],
    }
    linked = {
        "questions": [
            {**q, "companyItem": "co1"} if q["seq"] == 1 else q for q in QUESTIONS["questions"]
        ]
    }
    run, redis = make(FakeChat([CLAIMS, linked]))

    run(replace(JOB, company_card={"direction": [entry]}))

    questions = pushed(redis)[1]["questions"]
    assert questions[0]["companyItem"] == {"section": "direction", **entry}
    assert [q["companyItem"] for q in questions[1:]] == [None] * 4


def test_question_json_without_items_has_no_company_item() -> None:
    """회사 항목을 전달하지 않은 호출은 연결 번호가 있어도 companyItem이 null이다."""
    question = Question(1, "질문", "기준", "c1", "co1")

    assert question_json(question)["companyItem"] is None


def test_completed_plan_keeps_claims_not_passed_to_question_generation() -> None:
    """결과에는 질문 생성에 전달하지 않은 주장도 모두 담는다(AI 명세 2장).

    결과 생성(EVALUATE)이 면접 계획의 주장 전체로 자기소개서를 대조하기 때문이다.
    """
    claims = {
        "claims": [
            CLAIMS["claims"][0],
            {**CLAIMS["claims"][1], "talentCriteria": ["협력·소통"]},
        ]
    }
    chat = FakeChat([claims, {"questions": [question(seq, "c1") for seq in range(1, 6)]}])
    run, redis = make(chat)

    run(JOB)

    assert "c2 " not in chat.calls[1][1]["content"]
    assert [c["id"] for c in pushed(redis)[-1]["claims"]] == ["c1", "c2"]


# 개인 면접은 지원서에 저장된 주장을 수신한다(AI 명세 2장 STEP 01)
STORED_CLAIMS = (
    Claim("c1", "주문 조회 응답 시간을 40% 줄였다", ClaimType.NUMBER, 4, ("실행·성과",)),
    Claim("c2", "팀원과 갈등을 조율했다", ClaimType.EXPERIENCE, 6, ("협력·소통",)),
)
STORED_JOB = replace(JOB, claims=STORED_CLAIMS)


def test_stored_claims_skip_extraction_and_progress_first() -> None:
    """저장된 주장으로 질문만 생성하고, 주장이 준비된 시점이므로 시작할 때 진행률 50을 전송한다."""
    chat = FakeChat([{"questions": [question(seq, "c1") for seq in range(1, 6)]}])
    run, redis = make(chat)

    run(STORED_JOB)

    assert len(chat.calls) == 1
    assert chat.calls[0] == build_question_messages(STORED_JOB, STORED_CLAIMS[:1])
    messages = pushed(redis)
    assert [m["type"] for m in messages] == ["plan.progress", "plan.completed"]
    assert messages[0]["progress"] == 50


def test_completed_plan_returns_stored_claims_as_received() -> None:
    chat = FakeChat([{"questions": [question(seq, "c1") for seq in range(1, 6)]}])
    run, redis = make(chat)

    run(STORED_JOB)

    assert pushed(redis)[-1]["claims"] == [
        {
            "id": "c1",
            "text": "주문 조회 응답 시간을 40% 줄였다",
            "type": "NUMBER",
            "sentenceNo": 4,
            "talentCriteria": ["실행·성과"],
        },
        {
            "id": "c2",
            "text": "팀원과 갈등을 조율했다",
            "type": "EXPERIENCE",
            "sentenceNo": 6,
            "talentCriteria": ["협력·소통"],
        },
    ]


def test_stored_claims_job_sends_progress_before_timing_out() -> None:
    """진행률 50은 주장이 준비된 시점이므로 GMS를 호출하기 전 마감이 지나도 먼저 전송한다."""
    chat = FakeChat([{"questions": [question(seq, "c1") for seq in range(1, 6)]}])
    late = STORED_JOB.requested_at.timestamp() + PLAN_TIMEOUT_SECONDS + 1
    run, redis = make(chat, clock=lambda: late)

    run(STORED_JOB)

    assert chat.calls == []
    assert [m["type"] for m in pushed(redis)] == ["plan.progress", "plan.failed"]


def test_model_version_is_question_step_model() -> None:
    """채점 기준을 생성한 질문 생성 단계 응답의 모델 이름을 기록한다."""
    models = iter(["claims-model", "questions-model"])
    base = FakeChat([CLAIMS, QUESTIONS])

    def chat(messages: Sequence[Mapping[str, str]]) -> GmsResult:
        return replace(base(messages), model=next(models))

    run, redis = make(chat)

    run(JOB)

    assert pushed(redis)[-1]["modelVersion"] == "questions-model"


def test_claim_failure_publishes_failed_without_progress() -> None:
    run, redis = make(FakeChat([BROKEN_CLAIMS, BROKEN_CLAIMS]))

    run(JOB)

    assert pushed(redis) == [{**common("plan.failed"), "reason": "INVALID_OUTPUT"}]


def test_question_failure_publishes_failed_after_progress() -> None:
    run, redis = make(FakeChat([CLAIMS, FOUR_QUESTIONS, FOUR_QUESTIONS]))

    run(JOB)

    assert [(m["type"], m.get("reason")) for m in pushed(redis)] == [
        ("plan.progress", None),
        ("plan.failed", "INVALID_OUTPUT"),
    ]


@pytest.mark.parametrize(
    ("outcomes", "types"),
    [
        ([GmsUnavailableError("5xx")], ["plan.failed"]),
        ([CLAIMS, GmsUnavailableError("5xx")], ["plan.progress", "plan.failed"]),
    ],
)
def test_unavailable_gms_publishes_failed(
    outcomes: list[Any], types: list[str], caplog: pytest.LogCaptureFixture
) -> None:
    run, redis = make(FakeChat(outcomes))

    with caplog.at_level(logging.ERROR):
        run(JOB)

    assert [m["type"] for m in pushed(redis)] == types
    assert pushed(redis)[-1]["reason"] == "GMS_UNAVAILABLE"
    assert f"jobId={JOB_ID}" in caplog.text
    # 자소서 내용은 개인 정보이므로 실패 로그에 포함하지 않는다
    assert "주문 조회" not in caplog.text


class FailingRedis(FakeRedis):
    """정해진 순번의 LPUSH부터 계속 실패하는 대역.

    재시도까지 모두 실패하게 한다.
    """

    def __init__(self, fail_from: int) -> None:
        super().__init__()
        self._fail_from = fail_from

    def lpush(self, key: str, *values: str) -> int:
        if len(self.lists.get(key, [])) >= self._fail_from:
            raise RedisConnectionError("연결 중단")
        return super().lpush(key, *values)


@pytest.mark.parametrize(
    ("outcomes", "fail_from"),
    [
        # 진행률 전송 실패
        ([CLAIMS, QUESTIONS], 0),
        # 완료 결과 전송 실패
        ([CLAIMS, QUESTIONS], 1),
        # 실패 결과 전송 실패
        ([BROKEN_CLAIMS, BROKEN_CLAIMS], 0),
    ],
)
def test_result_publish_failure_is_raised(outcomes: list[Any], fail_from: int) -> None:
    """작업이 처리 중 리스트에 남아 다시 처리되도록 분배기까지 예외를 전파한다."""
    run, _ = make(FakeChat(outcomes), FailingRedis(fail_from))

    with pytest.raises(ResultPublishError):
        run(JOB)


def test_publish_failure_does_not_call_questions_step() -> None:
    chat = FakeChat([CLAIMS, QUESTIONS])
    run, _ = make(chat, FailingRedis(0))

    with pytest.raises(ResultPublishError):
        run(JOB)
    assert len(chat.calls) == 1


def test_missing_gms_settings_publishes_failed() -> None:
    """GMS 접속 값이 없으면 BE 대기 상한까지 대기시키지 않고 즉시 실패 결과를 전송한다."""
    run, redis = make(gms_plan_chat(lazy_gms_client(load_settings({}))))

    run(JOB)

    # GMS를 호출하지 않은 경우이므로 GMS_UNAVAILABLE이 아니라 그 밖의 오류다(AI 명세 1.4)
    assert pushed(redis) == [{**common("plan.failed"), "reason": "INTERNAL_ERROR"}]


def test_missing_gms_settings_job_is_handled() -> None:
    """실패 결과를 전송했으므로 분배기는 작업을 처리 완료로 판단해 큐에서 삭제하게 한다."""
    dispatcher = Dispatcher()
    run, _ = make(gms_plan_chat(lazy_gms_client(load_settings({}))))
    register_plan_handler(dispatcher, run)

    assert dispatcher.dispatch(JOB) is DispatchResult.HANDLED


def test_unexpected_error_publishes_internal_error(caplog: pytest.LogCaptureFixture) -> None:
    """작업을 남기면 재시작마다 같은 오류가 반복되므로 INTERNAL_ERROR로 마친다(AI 명세 5장)."""
    run, redis = make(FakeChat([RuntimeError("unexpected")]))

    with caplog.at_level(logging.ERROR, logger="app.interview.plan.job"):
        run(JOB)

    assert pushed(redis) == [{**common("plan.failed"), "reason": "INTERNAL_ERROR"}]
    assert caplog.records[0].exc_info is not None


class StepClock:
    """GMS를 호출할 때마다 정해진 시간이 흐르는 시계."""

    def __init__(self, chat: FakeChat, step: float, *, start: float | None = None) -> None:
        # 마감은 BE가 작업을 요청한 시각부터 계산하므로 기본으로 그 시각에서 시작한다
        self.now = JOB.requested_at.timestamp() if start is None else start
        self._chat = chat
        self._step = step

    def __call__(self) -> float:
        return self.now

    def chat(self, messages: Sequence[Mapping[str, str]]) -> GmsResult:
        self.now += self._step
        return self._chat(messages)


def test_publishes_timed_out_after_be_wait_limit() -> None:
    """BE 대기 상한(3분)이 지나면 다음 GMS 호출 전에 중단한다(AI 명세 5장)."""
    chat = FakeChat([CLAIMS, QUESTIONS])
    clock = StepClock(chat, PLAN_TIMEOUT_SECONDS + 1)
    run, redis = make(clock.chat, clock=clock)

    run(JOB)

    assert len(chat.calls) == 1
    assert pushed(redis) == [
        {**common("plan.progress"), "progress": 50},
        {**common("plan.failed"), "reason": "TIMED_OUT"},
    ]


def test_wait_in_queue_counts_toward_be_wait_limit() -> None:
    """큐에서 대기한 시간도 포함해 BE가 작업을 요청한 시각부터 마감을 계산한다(AI 명세 5장)."""
    chat = FakeChat([CLAIMS, QUESTIONS])
    clock = StepClock(chat, 0, start=JOB.requested_at.timestamp() + PLAN_TIMEOUT_SECONDS + 1)
    run, redis = make(clock.chat, clock=clock)

    run(JOB)

    assert chat.calls == []
    assert pushed(redis) == [{**common("plan.failed"), "reason": "TIMED_OUT"}]


def test_completes_within_be_wait_limit() -> None:
    chat = FakeChat([CLAIMS, QUESTIONS])
    clock = StepClock(chat, PLAN_TIMEOUT_SECONDS / 2 - 1)
    run, redis = make(clock.chat, clock=clock)

    run(JOB)

    assert pushed(redis)[-1]["type"] == "plan.completed"


def test_registered_as_plan_handler() -> None:
    dispatcher = Dispatcher()
    run, redis = make(FakeChat([CLAIMS, QUESTIONS]))

    register_plan_handler(dispatcher, run)

    assert dispatcher.dispatch(JOB) is DispatchResult.HANDLED
    assert pushed(redis)[-1]["type"] == "plan.completed"


def test_prompt_version_is_registered() -> None:
    assert REGISTRY.require(VersionKind.PROMPT, PROMPT_VERSION) == "plan-v8"


def test_plan_chat_checks_gms_settings_on_call() -> None:
    """작업자 시작 시점에는 확인하지 않으므로 LLM_* 값이 없어도 생성된다."""
    chat = gms_plan_chat(lazy_gms_client(load_settings({})))

    with pytest.raises(SettingsError, match="LLM_CHAT_URL"):
        chat([{"role": "user", "content": "질문"}])


def test_plan_chat_passes_messages_without_options() -> None:
    calls: list[tuple[list[Mapping[str, str]], dict[str, Any]]] = []

    class FakeClient:
        def chat_json(self, messages: Sequence[Mapping[str, str]], **options: Any) -> GmsResult:
            calls.append((list(messages), options))
            return GmsResult(content={}, model="gms-served")

    chat = gms_plan_chat(lambda: cast(GmsClient, FakeClient()))

    result = chat([{"role": "user", "content": "1"}])

    assert calls == [([{"role": "user", "content": "1"}], {})]
    assert result.model == "gms-served"
