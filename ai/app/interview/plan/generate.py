"""질문 생성 결과를 검증하고, 실패하면 AI 명세 2장·5장의 횟수만큼 다시 요청한다.

- 주장 추출과 질문 생성의 출력 구조가 깨지면(JSON 아님, 개수 틀림) 단계마다 1회 재시도한다.
  근거 문장과 맞는 주장이 하나도 없는 경우도 질문을 생성할 수 없으므로 같이 처리한다.
- claimId가 없는 주장을 가리키면 질문 5개를 다시 생성하지 않고 그 질문만 1회 다시 생성한다.
  올바른 질문까지 다시 생성하면 GMS 호출이 늘고 이미 검증한 질문이 변경되기 때문이다.
- 재시도해도 실패하면 PlanFailedError를 발생시킨다.
  GMS를 호출하지 못한 경우는 GMS 호출 계층이 이미 재시도했으므로
  GmsUnavailableError를 그대로 전파한다.
"""

import logging
from collections.abc import Sequence

from app.common.gms import STRUCTURE_RETRIES, Chat, GmsBadOutputError
from app.interview.plan.claims import ClaimSet, request_claims, split_sentences
from app.interview.plan.grounding import ground_claims
from app.interview.plan.llm import PlanFailedError, PlanOutputError
from app.interview.plan.questions import (
    Question,
    QuestionSet,
    check_question_set,
    request_question,
    request_questions,
)
from app.interview.plan.rules import CLAIM_ID_REGENERATIONS
from app.worker.messages import Claim, PlanJob

log = logging.getLogger(__name__)


def extract_claims(chat: Chat, job: PlanJob) -> ClaimSet:
    sentences = split_sentences(job.cover_letter)
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
            return QuestionSet(check_question_set(result.questions), result.model)
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


def generate_questions(chat: Chat, job: PlanJob, claims: Sequence[Claim]) -> QuestionSet:
    result = _question_set(chat, job, claims)
    claim_ids = {c.id for c in claims}
    questions = tuple(
        q if q.claim_id in claim_ids else _regenerate(chat, job, claims, q.seq)
        for q in result.questions
    )
    return QuestionSet(questions, result.model)
