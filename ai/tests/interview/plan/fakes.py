"""질문 생성 작업 테스트가 함께 사용하는 고정 데이터와 GMS 대역."""

from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

from app.common.cover_letter import CoverLetterItem
from app.common.gms import GmsResult
from app.worker.messages import PlanJob

JOB_ID = "8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34"
# BE가 작업을 요청한 시각(AI 명세 1.3 requestedAt)
REQUESTED_AT = datetime(2026, 10, 22, 14, 3, 13, tzinfo=timezone(timedelta(hours=9)))
JOB = PlanJob(
    job_id=JOB_ID,
    session_id=55,
    requested_at=REQUESTED_AT,
    company_name="○○전자",
    job_title="백엔드 개발자",
    cover_letter_items=(
        CoverLetterItem("지원 동기", "저는 대용량 트래픽을 다루는 서비스를 만들고 싶습니다."),
        CoverLetterItem(
            "직무 경험",
            "주문 조회 API의 응답 시간을 40% 줄였습니다. 캐시 계층을 직접 설계했습니다.\n"
            "팀원 4명과 장애 대응 절차를 정리했습니다.",
        ),
    ),
)


class FakeChat:
    """정해진 순서로 GMS 결과를 반환하거나 예외를 발생시키고 전송한 메시지를 기록한다."""

    def __init__(self, outcomes: Iterable[dict[str, Any] | Exception]) -> None:
        self._outcomes = list(outcomes)
        self.calls: list[list[dict[str, str]]] = []

    def __call__(self, messages: Sequence[Mapping[str, str]]) -> GmsResult:
        self.calls.append([dict(m) for m in messages])
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return GmsResult(content=outcome, token_logprobs=None, model="gms-served")


def question(seq: Any, claim_id: str = "c1") -> dict[str, Any]:
    return {
        "seq": seq,
        "content": f"{seq}번 질문의 근거는 무엇인가?",
        "criteria": "원인 분석 · 수치 근거",
        "claimId": claim_id,
    }
