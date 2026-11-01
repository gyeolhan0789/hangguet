"""질문 생성 결과를 검증하고, 실패하면 AI 명세 2장·5장의 횟수만큼 다시 요청한다.

- 주장 추출과 질문 생성의 출력 구조가 깨지면(JSON 아님, 개수 틀림) 단계마다 1회 재시도한다.
  근거 문장과 맞는 주장이 하나도 없는 경우도 질문을 생성할 수 없으므로 같이 처리한다.
- claimId가 없는 주장을 가리키면 질문 5개를 다시 생성하지 않고 그 질문만 1회 다시 생성한다.
  올바른 질문까지 다시 생성하면 GMS 호출이 늘고 이미 검증한 질문이 변경되기 때문이다.
- 면접관 기준이 드러나지 않은 주장(targetClaims 밖)을 가리킨 질문도 같은 방식으로 다시 생성한다.
- 재시도해도 실패하면 PlanFailedError를 발생시킨다.
  GMS를 호출하지 못한 경우는 GMS 호출 계층이 이미 재시도했으므로
  GmsUnavailableError를 그대로 전파한다.
"""

import logging
from collections.abc import Sequence

from app.common.gms import STRUCTURE_RETRIES, Chat, GmsBadOutputError
from app.common.session import Persona
from app.interview.plan.claims import ClaimSet, request_claims, split_sentences
from app.interview.plan.grounding import ground_claims
from app.interview.plan.llm import PlanFailedError, PlanOutputError
from app.interview.plan.questions import (
    Question,
    QuestionSet,
    TargetClaim,
    check_question_set,
    criteria_names,
    request_question,
    request_questions,
)
from app.interview.plan.rules import CLAIM_ID_REGENERATIONS
from app.worker.messages import Claim, PlanJob

log = logging.getLogger(__name__)


def extract_claims(chat: Chat, job: PlanJob) -> ClaimSet:
    sentences = split_sentences(job.cover_letter_items)
    for attempt in range(STRUCTURE_RETRIES + 1):
        try:
            result = request_claims(chat, job)
            return ClaimSet(ground_claims(result.claims, sentences), result.model)
        except (GmsBadOutputError, PlanOutputError) as e:
            log.warning("주장 추출 출력 구조 깨짐 %d회: %s", attempt + 1, e)
    raise PlanFailedError("주장 추출 출력 구조가 재시도 후에도 깨져 있다")


def _question_set(chat: Chat, job: PlanJob, claims: Sequence[Claim]) -> QuestionSet:
    for attempt in range(STRUCTURE_RETRIES + 1):
        try:
            result = request_questions(chat, job, claims)
            return QuestionSet(check_question_set(result.questions), result.model, result.targets)
        except (GmsBadOutputError, PlanOutputError) as e:
            log.warning("질문 생성 출력 구조 깨짐 %d회: %s", attempt + 1, e)
    raise PlanFailedError("질문 생성 출력 구조가 재시도 후에도 깨져 있다")


def _regenerate(chat: Chat, job: PlanJob, claims: Sequence[Claim], seq: int) -> Question:
    claim_ids = {c.id for c in claims}
    for attempt in range(CLAIM_ID_REGENERATIONS):
        try:
            question = request_question(chat, job, claims, seq)
        except (GmsBadOutputError, PlanOutputError) as e:
            log.warning("질문 다시 생성 출력 구조 깨짐 seq=%d %d회: %s", seq, attempt + 1, e)
            continue
        if question.claim_id in claim_ids:
            return question
        log.warning("다시 생성한 질문의 claimId가 없는 주장 seq=%d", seq)
    raise PlanFailedError(f"{seq}번 질문의 claimId가 다시 생성한 뒤에도 주장 목록에 없다")


def _criteria(criterion: str) -> set[str]:
    return {name.strip() for name in criterion.split(",")}


def target_claims(
    claims: Sequence[Claim], targets: Sequence[TargetClaim], persona: Persona
) -> tuple[Claim, ...]:
    """면접관 기준이 드러났다고 GMS가 고른 주장 중 기준 이름이 그 면접관의 기준인 것만 반환한다.

    프롬프트로 기준을 지정해도 기준이 드러나지 않은 주장으로 질문이 생성되므로
    코드에서 질문에 사용할 수 있는 주장을 제한한다(plan-v3 GMS 실측).
    해당하는 주장이 없으면 면접 종류와 맞지 않는 자기소개서이므로
    플랜 생성이 실패하지 않도록 모든 주장을 사용한다.
    """
    allowed = criteria_names(persona)
    # 모델이 한 주장에 기준을 쉼표로 여러 개 작성하므로(gpt-6-astra 실측) 하나라도 맞으면 인정한다
    ids = {t.claim_id for t in targets if allowed & _criteria(t.criterion)}
    selected = tuple(c for c in claims if c.id in ids)
    if not selected:
        log.warning("면접관 기준이 드러난 주장이 없어 모든 주장을 사용한다 persona=%s", persona)
        return tuple(claims)
    return selected


def generate_questions(chat: Chat, job: PlanJob, claims: Sequence[Claim]) -> QuestionSet:
    result = _question_set(chat, job, claims)
    usable = target_claims(claims, result.targets, job.persona)
    claim_ids = {c.id for c in usable}
    questions = tuple(
        q if q.claim_id in claim_ids else _regenerate(chat, job, usable, q.seq)
        for q in result.questions
    )
    return QuestionSet(questions, result.model)
