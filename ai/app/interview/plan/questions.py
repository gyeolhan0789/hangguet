"""질문·기준 생성(AI 명세 2장 STEP 02): 주장을 검증하는 질문과 질문별 채점 기준을 생성한다."""

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.common.gms import Chat
from app.common.session import MAX_SEQ, MIN_SEQ, QUESTION_COUNT, Persona
from app.interview.company import BUSINESS_TITLE, TALENT_TITLE, company_section
from app.interview.interviewer import COVER_LETTER, interviewer_guide
from app.interview.plan.llm import PlanOutputError
from app.interview.plan.rules import COMPANY_LINKED_MAX, COMPANY_LINKED_MIN
from app.worker.messages import Claim, PlanJob

# 회사 카드 사용 지침(AI 명세 2장 회사 카드 사용).
# 꼬리질문 생성은 회사 카드를 받지 않으므로 면접관 공용 지침(app.interview.interviewer)과 나누어
# 질문 생성에만 둔다
_COMPANY_GUIDES: Mapping[Persona, str] = {
    Persona.COFFEE_CHAT: (
        f"- [{BUSINESS_TITLE}]이 주어지면 경험과 이어지는 경우에만 "
        "경험을 회사 사업 방향·시장과 연결해 묻는다. "
        "주어지지 않은 회사 정보를 전제로 묻지 않는다\n"
    ),
    Persona.DEVIL: (
        f"- [{TALENT_TITLE}]이 주어지면 자소서 주장을 회사 인재상과 연결해 묻는다. "
        "주어지지 않은 회사 정보를 전제로 묻지 않는다\n"
    ),
    Persona.DUCK: (
        f"- [{TALENT_TITLE}]이나 [{BUSINESS_TITLE}]이 주어지면 "
        "자소서 경험과 이어지는 경우에만 회사 정보와 연결해 묻는다. "
        "주어지지 않은 회사 정보를 전제로 묻지 않는다\n"
    ),
}


def _guide(persona: Persona) -> str:
    return interviewer_guide(persona, COVER_LETTER) + _COMPANY_GUIDES.get(persona, "")


def question_system(persona: Persona) -> str:
    return (
        "너는 지원자의 자기소개서 주장을 검증하는 면접 질문을 생성한다. "
        "주어진 주장에 없는 경험을 전제로 질문하지 않는다.\n"
        f"{_guide(persona)}"
        f"- questions: 정확히 {QUESTION_COUNT}개, seq는 {MIN_SEQ}부터 {MAX_SEQ}까지 하나씩\n"
        "- claimId: 주장 목록에 있는 주장의 id만 그대로 작성한다. "
        f"주장이 {QUESTION_COUNT}개보다 적으면 "
        "같은 주장을 위 기준 중 다른 기준으로 나누어 다시 질문하고, "
        "많으면 검증 가치가 큰 주장을 고른다\n"
        "- content: 지원자에게 묻는 질문 한 문장\n"
        "- criteria: 이 질문의 답변을 채점할 기준 한 줄. 좋은 답변이 갖춰야 할 내용을 작성한다\n"
        "- companyItem: 회사 정보가 주어지면 "
        f"{COMPANY_LINKED_MIN[persona]}~{COMPANY_LINKED_MAX}개 질문만 회사 정보와 연결하고, "
        "연결한 질문에는 연결한 회사 항목 번호를 그대로 작성한다. "
        "질문 내용이 회사 정보를 다루지 않으면 연결하지 않는다. "
        "연결하지 않은 질문과 회사 정보가 없을 때는 빈 문자열로 작성한다\n"
        "JSON으로만 답한다: "
        '{"questions": [{"seq": int, "content": str, "criteria": str, "claimId": str, '
        '"companyItem": str}]}'
    )


@dataclass(frozen=True)
class Question:
    seq: int
    content: str
    criteria: str
    claim_id: str
    # 질문에 연결한 회사 항목 번호. GMS 응답 검사에만 사용하고 플랜에는 저장하지 않는다
    company_item: str | None = None


@dataclass(frozen=True)
class QuestionSet:
    questions: tuple[Question, ...]
    # GMS 응답의 모델 이름이다
    model: str


def claims_text(claims: Sequence[Claim]) -> str:
    return "\n".join(f"{c.id} ({c.type.value}, 문장 {c.sentence_no}) {c.text}" for c in claims)


def _company(job: PlanJob) -> str:
    section = company_section(job.company_card, job.persona)
    return f"{section}\n\n" if section else ""


def build_question_messages(job: PlanJob, claims: Sequence[Claim]) -> list[dict[str, str]]:
    user = (
        f"회사: {job.company_name}\n직무: {job.job_title}\n\n"
        f"{_company(job)}[주장]\n{claims_text(claims)}"
    )
    return [
        {"role": "system", "content": question_system(job.persona)},
        {"role": "user", "content": user},
    ]


def _text(item: dict[str, Any], key: str, field: str = "questions") -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise PlanOutputError(f"{field}.{key}가 없다")
    return value.strip()


def parse_question(item: Any) -> Question:
    if not isinstance(item, dict):
        raise PlanOutputError("questions 항목이 객체가 아니다")
    seq = item.get("seq")
    # bool은 int의 하위 형식이므로 true가 1번 질문으로 해석되지 않도록 형식을 정확히 비교한다
    if type(seq) is not int:
        raise PlanOutputError("questions.seq가 정수가 아니다")
    company_item = item.get("companyItem")
    if company_item is not None and not isinstance(company_item, str):
        raise PlanOutputError("questions.companyItem이 문자열이 아니다")
    return Question(
        seq,
        _text(item, "content"),
        _text(item, "criteria"),
        _text(item, "claimId"),
        company_item.strip() or None if company_item else None,
    )


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


def check_question_set(questions: Sequence[Question]) -> tuple[Question, ...]:
    """질문이 정확히 5개이고 seq가 1~5에 하나씩인지 검사하고 seq 순서로 반환한다."""
    if sorted(q.seq for q in questions) != list(range(MIN_SEQ, MAX_SEQ + 1)):
        raise PlanOutputError(f"questions는 seq {MIN_SEQ}~{MAX_SEQ}의 {QUESTION_COUNT}개여야 한다")
    return tuple(sorted(questions, key=lambda q: q.seq))


def check_company_links(
    questions: Sequence[Question], item_ids: Collection[str], persona: Persona
) -> None:
    """회사 정보와 연결한 질문 수와 연결한 항목 번호를 검사한다.

    회사 정보가 있으면 연결한 질문이 면접관별 COMPANY_LINKED_MIN~MAX개여야 하고,
    연결한 항목 번호는 주어진 회사 항목이어야 한다(카드에 없는 회사 정보를 전제로 묻지 않음).
    """
    linked = [q.company_item for q in questions if q.company_item is not None]
    if any(item_id not in item_ids for item_id in linked):
        raise PlanOutputError("questions.companyItem이 주어진 회사 항목이 아니다")
    minimum = COMPANY_LINKED_MIN[persona]
    if item_ids and not minimum <= len(linked) <= COMPANY_LINKED_MAX:
        raise PlanOutputError(
            f"회사 정보와 연결한 질문은 {minimum}~{COMPANY_LINKED_MAX}개여야 한다"
        )


def regenerate_system(persona: Persona) -> str:
    # 다시 생성한 질문 하나만 수준이 달라지지 않도록 처음 생성과 같은 지침을 사용한다
    return (
        "너는 지원자의 자기소개서 주장을 검증하는 면접 질문 하나를 다시 생성한다. "
        "주어진 주장에 없는 경험을 전제로 질문하지 않는다.\n"
        f"{_guide(persona)}"
        "- claimId: 주장 목록에 있는 id 하나를 그대로 작성한다\n"
        "- content: 지원자에게 묻는 질문 한 문장\n"
        "- criteria: 이 질문의 답변을 채점할 기준 한 줄. 좋은 답변이 갖춰야 할 내용을 작성한다\n"
        'JSON으로만 답한다: {"question": {"content": str, "criteria": str, "claimId": str}}'
    )


def build_regenerate_messages(
    job: PlanJob, claims: Sequence[Claim], seq: int
) -> list[dict[str, str]]:
    user = (
        f"회사: {job.company_name}\n직무: {job.job_title}\n\n"
        f"{_company(job)}[주장]\n{claims_text(claims)}\n\n"
        f"[다시 생성할 질문]\n{seq}번 질문. 이전 질문의 claimId가 주장 목록에 없었다."
    )
    return [
        {"role": "system", "content": regenerate_system(job.persona)},
        {"role": "user", "content": user},
    ]


def request_question(chat: Chat, job: PlanJob, claims: Sequence[Claim], seq: int) -> Question:
    """GMS를 한 번 호출해 seq번 질문 하나를 다시 생성한다.

    seq는 다시 생성하는 질문의 자리이므로 GMS 출력과 관계없이 요청한 seq를 사용한다.
    """
    result = chat(build_regenerate_messages(job, claims, seq))
    item = result.content.get("question")
    if not isinstance(item, dict):
        raise PlanOutputError("question이 객체가 아니다")
    return parse_question({**item, "seq": seq})
