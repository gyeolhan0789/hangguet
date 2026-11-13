"""질문 생성 작업(PLAN) 처리 함수.

분석 작업자의 분배기에 PlanJob으로 등록한다.
AI는 DB와 진행 상태 Hash에 접속하지 않으므로 처리 결과를 결과 메시지로만 전송한다(AI 명세 1.4·2장).
- 주장 추출이 끝나면 plan.progress(50), 질문 생성이 끝나면 plan.completed를 전송한다.
  개인 면접은 지원서에 저장된 주장을 수신하므로 주장을 추출하지 않고
  시작할 때 plan.progress(50)를 전송하며, 결과에는 수신한 주장을 그대로 담는다(AI 명세 2장).
- GMS 호출이 재시도 후에도 실패하거나 결과 검증에 실패하면 plan.failed를 전송한다.
  화면은 면접 플랜 재생성 API(5.3)로 다시 요청한다.
- GMS 접속 값이 없으면(SettingsError) 값을 추가할 때까지 모든 작업이 같은 오류로 실패하므로
  즉시 plan.failed(INTERNAL_ERROR)를 전송한다.
  GMS를 호출하지 않은 경우라 GMS_UNAVAILABLE이 아니다(AI 명세 1.4).
  재전파하면 작업마다 화면이 BE 대기 상한(질문 생성 3분)까지 대기하고,
  처리 중 리스트에 남은 작업을 작업자를 다시 시작할 때 다시 처리해
  BE가 폐기할 결과를 획득하기 위해 GMS를 호출하게 된다.
- 중복 수신과 순서 역전(재생성 뒤 늦게 도착한 이전 결과)은
  BE가 planStatus와 interview_plans 행으로 판단하므로,
  같은 작업을 두 번 처리해 결과를 두 번 전송하는 경우를 허용한다(AI 명세 1.4).
- BE 대기 상한(3분)이 지나면 GMS를 호출하기 전에 중단하고 plan.failed(TIMED_OUT)를 전송한다.
  BE가 FAILED로 처리할 작업에 GMS 비용과 대기 중인 다른 작업의 처리 시간을 사용하지 않기 위함이다.
- 예상하지 못한 그 밖의 예외는 plan.failed(INTERNAL_ERROR)를 전송하고 원인을 로그에 남긴다.
  작업을 처리 중 리스트에 남기면
  작업자를 다시 시작할 때마다 같은 오류가 반복되기 때문이다(AI 명세 5장).
- 결과 큐 전송이 재시도 후에도 실패하면 ResultPublishError를 재전파한다.
  작업이 처리 중 리스트에 남아 작업자를 다시 시작할 때 한 번 더 처리되고,
  그 전에 BE 대기 상한이 지나면 BE가 FAILED로 변경한다.
"""

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from app.common.gms import (
    Chat,
    GmsClient,
    GmsDeadlineError,
    GmsResult,
    GmsUnavailableError,
    with_deadline,
)
from app.common.results import (
    REASON,
    FailureReason,
    ResultPublisher,
    ResultPublishError,
    ResultType,
)
from app.common.versions import REGISTRY, VersionKind
from app.interview.company import CompanyItem
from app.interview.plan.generate import extract_claims, generate_questions
from app.interview.plan.llm import PlanFailedError
from app.interview.plan.questions import Question
from app.interview.plan.rules import PROGRESS_AFTER_CLAIMS
from app.worker.dispatch import Dispatcher
from app.worker.messages import Claim, PlanJob

log = logging.getLogger(__name__)

# claims.py·questions.py의 프롬프트를 변경하면 이 버전을 올리고 versions.py에 등록한다.
# 등록되지 않았으면 작업을 처리하기 전에 import 단계에서 실패한다
PROMPT_VERSION = REGISTRY.require(VersionKind.PROMPT, "plan-v8")
# BE 최대 대기 시간(BE 설계 5.1, application.yml ai-job.plan-timeout, AI 명세 5장)과 같은 값이다.
# BE가 작업을 요청한 시각(requestedAt)부터 계산해 큐에서 대기한 시간까지 포함한다(AI 명세 5장)
PLAN_TIMEOUT_SECONDS = 180.0


def claim_json(claim: Claim) -> dict[str, Any]:
    """AI 명세 2장 claims 항목 형식이다.

    EVALUATE 작업 메시지의 claims와 같은 필드 이름이다.
    """
    return {
        "id": claim.id,
        "text": claim.text,
        "type": claim.type.value,
        "sentenceNo": claim.sentence_no,
        "talentCriteria": list(claim.talent_criteria),
    }


def question_json(
    question: Question, *, items: Mapping[str, CompanyItem] | None = None
) -> dict[str, Any]:
    """AI 명세 2장 questions 항목 형식이다.

    items는 회사 항목 번호별 회사 항목이고, 생략하면 companyItem은 null이다.
    회사 항목을 반환하기 전에 작성한 호출(효용지표 골든셋 질문 생성)이
    그대로 동작하게 하기 위함이다.
    """
    item = items[question.company_item] if items is not None and question.company_item else None
    return {
        "seq": question.seq,
        "content": question.content,
        "criteria": question.criteria,
        "claimId": question.claim_id,
        "companyItem": item.json() if item else None,
    }


class PlanJobHandler:
    def __init__(
        self,
        results: ResultPublisher,
        chat: Chat,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._results = results
        self._chat = chat
        self._clock = clock

    def __call__(self, job: PlanJob) -> None:
        deadline = job.requested_at.timestamp() + PLAN_TIMEOUT_SECONDS
        chat = with_deadline(self._chat, deadline, self._clock)
        try:
            claims = job.claims if job.claims is not None else extract_claims(chat, job).claims
            self._results.publish_job_result(
                job, ResultType.PLAN_PROGRESS, {"progress": PROGRESS_AFTER_CLAIMS}
            )
            questions = generate_questions(chat, job, claims)
        except ResultPublishError:
            raise
        except GmsUnavailableError as e:
            self._fail(job, FailureReason.GMS_UNAVAILABLE, e)
            return
        except PlanFailedError as e:
            self._fail(job, FailureReason.INVALID_OUTPUT, e)
            return
        except GmsDeadlineError as e:
            self._fail(job, FailureReason.TIMED_OUT, e)
            return
        except Exception as e:
            self._fail(job, FailureReason.INTERNAL_ERROR, e)
            return
        self._results.publish_job_result(
            job,
            ResultType.PLAN_COMPLETED,
            {
                "claims": [claim_json(c) for c in claims],
                "questions": [
                    question_json(q, items={item.id: item for item in questions.company_items})
                    for q in questions.questions
                ],
                "promptVersion": PROMPT_VERSION,
                # 채점 기준을 생성한 질문 생성 단계 응답의 모델 이름을 기록한다
                "modelVersion": questions.model,
            },
        )

    def _fail(self, job: PlanJob, reason: FailureReason, error: Exception) -> None:
        # 원인이 분명하지 않은 오류만 추적 정보를 남긴다
        log.error(
            "질문 생성 실패 reason=%s sessionId=%s jobId=%s: %r",
            reason,
            job.session_id,
            job.job_id,
            error,
            exc_info=reason is FailureReason.INTERNAL_ERROR,
        )
        self._results.publish_job_result(job, ResultType.PLAN_FAILED, {REASON: reason.value})


def gms_plan_chat(client: Callable[[], GmsClient]) -> Chat:
    """주장 추출·질문 생성이 사용하는 GMS 호출 함수를 반환한다.

    client는 GMS 클라이언트를 반환하는 함수다.
    채점·결과 생성 작업과 같은 클라이언트를 공유하도록
    작업자 실행부(app.worker.main)가 생성해 전달한다.
    접속 값이 없으면 호출할 때 SettingsError가 발생해 plan.failed(INTERNAL_ERROR)로 처리된다.
    """

    def call(messages: Sequence[Mapping[str, str]]) -> GmsResult:
        return client().chat_json(messages)

    return call


def register_plan_handler(dispatcher: Dispatcher, handler: PlanJobHandler) -> None:
    dispatcher.register(PlanJob, handler)
