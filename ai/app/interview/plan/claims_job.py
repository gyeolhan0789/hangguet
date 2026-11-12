"""지원서 주장 추출 작업(EXTRACT_CLAIMS) 처리 함수.

분석 작업자의 분배기에 ExtractClaimsJob으로 등록한다.
BE는 지원서를 저장한 뒤 이 작업을 요청하고, 개인 면접의 질문 생성은 저장된 주장을 입력으로 수신한다
(AI 명세 2장 STEP 01).
- 주장 추출과 근거 검사는 질문 생성(PLAN)의 STEP 01과 같은 함수로 처리한다.
- 결과는 지원서 단위이므로 sessionId 대신 applicationId로 전송한다(AI 명세 1.3).
- 실패 이유와 처리는 질문 생성 작업과 같다(app.interview.plan.job).
  BE 대기 상한도 질문 생성과 같은 3분이다(AI 명세 5장).
"""

import logging
import time
from collections.abc import Callable
from typing import Any

from app.common.gms import Chat, GmsDeadlineError, GmsUnavailableError, with_deadline
from app.common.results import (
    REASON,
    FailureReason,
    ResultPublisher,
    ResultPublishError,
    ResultType,
)
from app.common.versions import REGISTRY, VersionKind
from app.interview.plan.generate import extract_claims
from app.interview.plan.job import PLAN_TIMEOUT_SECONDS, claim_json
from app.interview.plan.llm import PlanFailedError
from app.worker.dispatch import Dispatcher
from app.worker.messages import ExtractClaimsJob

log = logging.getLogger(__name__)

# claims.py의 프롬프트를 변경하면 이 버전을 올리고 versions.py에 등록한다(AI 명세 9장)
PROMPT_VERSION = REGISTRY.require(VersionKind.PROMPT, "extract-claims-v1")


class ExtractClaimsJobHandler:
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

    def __call__(self, job: ExtractClaimsJob) -> None:
        deadline = job.requested_at.timestamp() + PLAN_TIMEOUT_SECONDS
        chat = with_deadline(self._chat, deadline, self._clock)
        try:
            claims = extract_claims(chat, job)
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
        fields: dict[str, Any] = {
            "claims": [claim_json(c) for c in claims.claims],
            "promptVersion": PROMPT_VERSION,
            "modelVersion": claims.model,
        }
        self._results.publish_application_result(
            ResultType.CLAIMS_EXTRACTED, job.application_id, fields, job_id=job.job_id
        )

    def _fail(self, job: ExtractClaimsJob, reason: FailureReason, error: Exception) -> None:
        # 원인이 분명하지 않은 오류만 추적 정보를 남긴다
        log.error(
            "주장 추출 실패 reason=%s applicationId=%s jobId=%s: %r",
            reason,
            job.application_id,
            job.job_id,
            error,
            exc_info=reason is FailureReason.INTERNAL_ERROR,
        )
        self._results.publish_application_result(
            ResultType.CLAIMS_EXTRACT_FAILED,
            job.application_id,
            {REASON: reason.value},
            job_id=job.job_id,
        )


def register_extract_claims_handler(
    dispatcher: Dispatcher, handler: ExtractClaimsJobHandler
) -> None:
    dispatcher.register(ExtractClaimsJob, handler)
