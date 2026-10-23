"""질문·기준 생성(AI 명세 2장 STEP 02): 주장을 검증하는 질문과 질문별 채점 기준을 생성한다."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from app.common.gms import Chat
from app.interview.plan.llm import PlanOutputError
from app.worker.messages import MAX_SEQ, MIN_SEQ, QUESTION_COUNT, Claim, PlanJob

SYSTEM = (
    "너는 지원자의 자기소개서 주장을 검증하는 면접 질문을 생성한다. "
    "주어진 주장에 없는 경험을 전제로 질문하지 않는다.\n"
    f"- questions: 정확히 {QUESTION_COUNT}개, seq는 {MIN_SEQ}부터 {MAX_SEQ}까지 하나씩\n"
    "- claimId: 질문이 검증하는 주장의 id를 그대로 작성한다. "
    f"주장이 {QUESTION_COUNT}개보다 적으면 같은 주장을 다른 관점으로 다시 질문하고, "
    "많으면 검증 가치가 큰 주장을 고른다\n"
    "- content: 지원자에게 묻는 질문 한 문장\n"
    "- criteria: 이 질문의 답변을 채점할 기준 한 줄. 좋은 답변이 갖춰야 할 내용을 작성한다\n"
    'JSON으로만 답한다: {"questions": [{"seq": int, "content": str, "criteria": str, '
    '"claimId": str}]}'
)


@dataclass(frozen=True)
class Question:
    seq: int
    content: str
    criteria: str
    claim_id: str


@dataclass(frozen=True)
class QuestionSet:
    questions: tuple[Question, ...]
    # GMS 응답의 모델 이름이다
    model: str


def claims_text(claims: Sequence[Claim]) -> str:
    return "\n".join(f"{c.id} ({c.type.value}, 문장 {c.sentence_no}) {c.text}" for c in claims)


def build_question_messages(job: PlanJob, claims: Sequence[Claim]) -> list[dict[str, str]]:
    user = f"회사: {job.company_name}\n직무: {job.job_title}\n\n[주장]\n{claims_text(claims)}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def _text(item: dict[str, Any], key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise PlanOutputError(f"questions.{key}가 없다")
    return value.strip()


def parse_question(item: Any) -> Question:
    if not isinstance(item, dict):
        raise PlanOutputError("questions 항목이 객체가 아니다")
    seq = item.get("seq")
    # bool은 int의 하위 형식이므로 true가 1번 질문으로 해석되지 않도록 형식을 정확히 비교한다
    if type(seq) is not int:
        raise PlanOutputError("questions.seq가 정수가 아니다")
    return Question(seq, _text(item, "content"), _text(item, "criteria"), _text(item, "claimId"))


def parse_questions(content: dict[str, Any]) -> tuple[Question, ...]:
    """질문 항목의 형식만 검사한다.

    질문 수·seq와 claimId는 결과 검증 단계가 검사한다.
    """
    raw = content.get("questions")
    if not isinstance(raw, list):
        raise PlanOutputError("questions가 목록이 아니다")
    return tuple(parse_question(item) for item in raw)


def request_questions(chat: Chat, job: PlanJob, claims: Sequence[Claim]) -> QuestionSet:
    """GMS를 한 번 호출해 질문과 채점 기준을 생성한다."""
    result = chat(build_question_messages(job, claims))
    return QuestionSet(parse_questions(result.content), result.model)
