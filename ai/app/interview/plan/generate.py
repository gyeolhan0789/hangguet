"""질문 생성 결과를 검증하고, 실패하면 AI 명세 2장·5장의 횟수만큼 다시 요청한다.

- 주장 추출과 질문 생성의 출력 구조가 깨지면(JSON 아님, 개수 틀림) 단계마다 1회 재시도한다.
  근거 문장과 맞는 주장이 하나도 없는 경우도 질문을 생성할 수 없으므로 같이 처리한다.
- claimId가 없는 주장을 가리키면 질문 전체를 다시 생성하지 않고 그 질문만 1회 다시 생성한다.
  올바른 질문까지 다시 생성하면 GMS 호출이 늘고 이미 검증한 질문이 변경되기 때문이다.
- 질문 생성에는 주장의 인재상 기준(talentCriteria)이 면접관 기준과 겹치는 주장만 전달하고,
  전달하지 않은 주장을 가리킨 질문도 같은 방식으로 다시 생성한다(AI 명세 2장 면접관별 주장 선택).
- 회사 정보와 연결한 질문 수나 항목 번호가 어긋나거나 인재상 항목을 연결 후보가 아닌 주장과 연결하면
  질문 전체를 1회 다시 요청한다.
  다시 요청해도 어긋나면 플랜 생성이 실패하지 않도록 그대로 사용하고,
  후보에 없는 회사 항목 번호만 연결하지 않은 것으로 처리한다.
- 회사 항목과 연결한 질문을 다시 생성하면 같은 회사 항목과 연결한다.
- 재시도해도 실패하면 PlanFailedError를 발생시킨다.
  GMS를 호출하지 못한 경우는 GMS 호출 계층이 이미 재시도했으므로
  GmsUnavailableError를 그대로 전파한다.
"""

import logging
from collections.abc import Sequence
from dataclasses import replace

from app.common.gms import STRUCTURE_RETRIES, Chat, GmsBadOutputError
from app.common.session import Persona
from app.interview.company import CompanyItem
from app.interview.plan.claims import ClaimSet, ClaimSource, request_claims, split_sentences
from app.interview.plan.grounding import ground_claims
from app.interview.plan.llm import PlanFailedError, PlanOutputError
from app.interview.plan.questions import (
    Question,
    QuestionSet,
    check_company_links,
    check_question_set,
    company_candidates,
    request_question,
    request_questions,
)
from app.interview.plan.rules import CLAIM_ID_REGENERATIONS
from app.interview.talent import criteria_names
from app.worker.messages import Claim, PlanJob

log = logging.getLogger(__name__)


def extract_claims(chat: Chat, job: ClaimSource) -> ClaimSet:
    sentences = split_sentences(job.cover_letter_items)
    for attempt in range(STRUCTURE_RETRIES + 1):
        try:
            result = request_claims(chat, job)
            return ClaimSet(ground_claims(result.claims, sentences), result.model)
        except (GmsBadOutputError, PlanOutputError) as e:
            log.warning("주장 추출 출력 구조 깨짐 %d회: %s", attempt + 1, e)
    raise PlanFailedError("주장 추출 출력 구조가 재시도 후에도 깨져 있다")


def _question_set(chat: Chat, job: PlanJob, claims: Sequence[Claim]) -> QuestionSet:
    items = company_candidates(job, claims)
    for attempt in range(STRUCTURE_RETRIES + 1):
        try:
            result = request_questions(chat, job, claims)
            questions = check_question_set(result.questions, job.question_count)
            # 회사 정보 연결이 어긋나도 플랜 생성 전체가 실패하지 않도록
            # 마지막 시도는 검사하지 않는다
            if attempt < STRUCTURE_RETRIES:
                check_company_links(questions, items, job.question_count)
            return QuestionSet(questions, result.model, tuple(items))
        except (GmsBadOutputError, PlanOutputError) as e:
            log.warning("질문 생성 출력 구조 깨짐 %d회: %s", attempt + 1, e)
    raise PlanFailedError("질문 생성 출력 구조가 재시도 후에도 깨져 있다")


def _regenerate(
    chat: Chat, job: PlanJob, claims: Sequence[Claim], seq: int, item: CompanyItem | None
) -> Question:
    # 다시 생성한 질문은 인재상 항목과 주장의 짝을 검사하지 않으므로
    # 인재상 항목과 연결한 질문은 그 항목과 연결할 수 있는 주장으로만 다시 생성한다
    if item is not None and item.claim_ids is not None:
        claims = [c for c in claims if c.id in item.claim_ids]
    claim_ids = {c.id for c in claims}
    for attempt in range(CLAIM_ID_REGENERATIONS):
        try:
            question = request_question(chat, job, claims, seq, item)
        except (GmsBadOutputError, PlanOutputError) as e:
            log.warning("질문 다시 생성 출력 구조 깨짐 seq=%d %d회: %s", seq, attempt + 1, e)
            continue
        if question.claim_id in claim_ids:
            return question
        log.warning("다시 생성한 질문의 claimId가 없는 주장 seq=%d", seq)
    raise PlanFailedError(f"{seq}번 질문의 claimId가 다시 생성한 뒤에도 주장 목록에 없다")


def select_claims(claims: Sequence[Claim], persona: Persona) -> tuple[Claim, ...]:
    """주장의 인재상 기준이 그 면접관 기준과 하나 이상 겹치는 주장만 반환한다(AI 명세 2장).

    주장을 지원서 단위로 저장해 여러 면접관이 함께 사용하므로,
    질문 생성 모델이 면접마다 주장을 고르지 않고 주장 추출 때 분류한 기준으로 먼저 고른다.
    겹치는 주장이 없으면 면접 종류와 맞지 않는 자기소개서이므로
    플랜 생성이 실패하지 않도록 모든 주장을 사용한다.
    """
    allowed = criteria_names(persona)
    selected = tuple(c for c in claims if allowed & set(c.talent_criteria))
    if not selected:
        log.warning("면접관 기준이 드러난 주장이 없어 모든 주장을 사용한다 persona=%s", persona)
        return tuple(claims)
    return selected


def generate_questions(chat: Chat, job: PlanJob, claims: Sequence[Claim]) -> QuestionSet:
    usable = select_claims(claims, job.persona)
    result = _question_set(chat, job, usable)
    claim_ids = {c.id for c in usable}
    by_id = {item.id: item for item in result.company_items}
    questions = []
    for q in result.questions:
        item = by_id.get(q.company_item) if q.company_item else None
        # 연결 검사를 하지 않는 마지막 시도만 후보에 없는 번호가 남는다.
        # 가리키는 회사 항목이 없으므로 연결하지 않은 질문으로 사용한다
        if q.company_item and item is None:
            log.warning("질문의 회사 항목 번호가 후보에 없어 연결하지 않는다 seq=%d", q.seq)
            q = replace(q, company_item=None)
        questions.append(
            q if q.claim_id in claim_ids else _regenerate(chat, job, usable, q.seq, item)
        )
    return QuestionSet(tuple(questions), result.model, result.company_items)
