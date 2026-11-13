"""질문·기준 생성(AI 명세 2장 STEP 02): 주장을 검증하는 질문과 질문별 채점 기준을 생성한다."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.common.gms import Chat
from app.common.session import MAX_SEQ, MIN_SEQ, QUESTION_COUNT, Persona
from app.interview.company import (
    BUSINESS_TITLE,
    RECENT_TITLE,
    TALENT_TITLE,
    CompanyItem,
    company_items,
    company_section,
)
from app.interview.interviewer import COVER_LETTER, interviewer_guide
from app.interview.job_ncs import competency_units, job_subcategories
from app.interview.plan.llm import PlanOutputError
from app.interview.plan.rules import COMPANY_LINKED_MAX
from app.worker.messages import Claim, PlanJob

# 회사 카드 사용 지침(AI 명세 2장 회사 카드 사용).
# 꼬리질문 생성은 회사 카드를 받지 않으므로 면접관 공용 지침(app.interview.interviewer)과 나누어
# 질문 생성에만 둔다
_COMPANY_GUIDES: Mapping[Persona, str] = {
    Persona.COFFEE_CHAT: (
        f"- [{BUSINESS_TITLE}]이 주어지면 경험과 이어지는 경우에만 "
        "경험을 회사 사업 방향·시장과 연결해 묻는다. "
        "주어지지 않은 회사 정보를 전제로 묻지 않는다\n"
        f"- [{RECENT_TITLE}]가 주어지면 경험과 이어지는 경우에만 사업 관련 이슈와 연결해 묻는다\n"
    ),
    Persona.DEVIL: (
        f"- [{TALENT_TITLE}]이 주어지면 자소서 주장을 회사 인재상과 연결해 묻는다. "
        "주어지지 않은 회사 정보를 전제로 묻지 않는다\n"
        f"- [{RECENT_TITLE}]가 주어지면 자소서 주장과 이어지는 경우 "
        "그 이슈에 대한 지원자의 판단을 묻는다\n"
    ),
    Persona.DUCK: (
        f"- [{TALENT_TITLE}]이나 [{BUSINESS_TITLE}]이 주어지면 "
        "자소서 경험과 이어지는 경우에만 회사 정보와 연결해 묻는다. "
        "주어지지 않은 회사 정보를 전제로 묻지 않는다\n"
        f"- [{RECENT_TITLE}]가 주어지면 경험과 이어지는 경우에만 이슈와 연결해 묻는다\n"
    ),
}


# 연결한 회사 항목에 따른 질문 형식(AI 명세 2장 회사 카드 사용).
# 인재상은 지원자가 과거에 실제로 한 행동으로 확인하는 가치이고,
# 사업 방향·시장·최근 이슈는 지원자가 앞으로 담당할 회사 상황이므로 형식을 나눈다
_FORMAT_RULES = (
    f"- 질문 형식: [{TALENT_TITLE}] 항목과 연결한 질문과 회사 정보와 연결하지 않은 질문은 "
    "과거 경험 질문이다. 자소서 경험에서 본인이 한 행동과 그 결과를 묻는다. "
    f"[{BUSINESS_TITLE}]·[{RECENT_TITLE}] 항목과 연결한 질문은 가정 상황 질문이다. "
    "회사 항목의 원문을 인용해 상황을 제시하고, "
    "자소서 경험의 방법을 그 상황에 어떻게 적용할지 묻는다\n"
    "- 회사 항목과 연결한 질문의 문장에는 그 항목의 내용이 들어가야 한다\n"
    "- 회사의 사건을 기준으로 지원자 경험이 충분한지 평가하는 질문과 "
    "회사 내부 사정을 알아야 답할 수 있는 질문은 하지 않는다\n"
)


# 회사 항목과 연결한 질문의 채점 기준(AI 명세 2장 회사 카드 사용).
# 답변 채점(AI 명세 3장)은 회사 카드를 받지 않으므로 채점 기준으로 회사 정보를 반영한다.
# 채점 기준에 회사를 주어로 작성하면 답변 채점이 회사를 언급하지 않은 답변을 감점할 수 있으므로
# 항목 내용을 답변이 다룰 상황으로 작성하게 한다(GMS 실측)
_CRITERIA_RULES = (
    "- 회사 항목과 연결한 질문의 criteria에는 그 항목의 내용을 좋은 답변이 갖춰야 할 내용으로 "
    "포함한다. 지원자가 회사 이름이나 회사 항목을 직접 말하도록 요구하지 않는다. "
    "회사 이름·제품명이나 '회사 사업 방향' 같은 표현 없이, 항목의 내용을 답변이 다룰 상황으로 "
    "작성한다(예: 배송·결제 속도가 경쟁 요소인 상황의 문제 정의 · 적용 방법과 이유 · 확인 방법)\n"
)


def _guide(persona: Persona) -> str:
    return (
        interviewer_guide(persona, COVER_LETTER)
        + _COMPANY_GUIDES.get(persona, "")
        + _FORMAT_RULES
        + _CRITERIA_RULES
    )


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
        f"0~{COMPANY_LINKED_MAX}개 질문만 회사 정보와 연결하고, "
        "연결한 질문에는 연결한 회사 항목 번호를 그대로 작성한다. "
        "인재상 항목은 괄호에 적힌 주장과만 연결하고, "
        "회사 항목이 경험과 이어지지 않으면 연결하지 않는다. "
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
    # 질문에 연결한 회사 항목 번호. 플랜에는 이 번호가 가리키는 회사 항목을 저장한다
    company_item: str | None = None


@dataclass(frozen=True)
class QuestionSet:
    questions: tuple[Question, ...]
    # GMS 응답의 모델 이름이다
    model: str
    # 질문 생성에 전달한 회사 항목. 질문의 company_item 번호가 가리킨다
    company_items: tuple[CompanyItem, ...] = ()


def claims_text(claims: Sequence[Claim]) -> str:
    return "\n".join(f"{c.id} ({c.type.value}, 문장 {c.sentence_no}) {c.text}" for c in claims)


def company_candidates(job: PlanJob, claims: Sequence[Claim]) -> list[CompanyItem]:
    """질문에 연결할 수 있는 회사 항목을 반환한다(AI 명세 2장 회사 카드 사용).

    claims는 질문 생성에 전달하는 주장이다. 인재상 항목은 이 주장의 인재상 기준으로,
    사업 방향·시장 항목은 지원 직무명을 변환한 NCS 세분류로 후보를 선별한다.
    """
    return company_items(job.company_card, job.persona, claims, job_subcategories(job.job_title))


def _company(items: Sequence[CompanyItem]) -> str:
    section = company_section(items)
    return f"{section}\n\n" if section else ""


def _units(job: PlanJob, items: Sequence[CompanyItem]) -> str:
    """지원 직무의 NCS 능력단위를 전달한다.

    회사 항목이 지원 직무가 담당할 상황이고 자기소개서 경험과 실제로 이어지는지
    모델이 판단하도록 직무가 담당할 일을 함께 전달한다.
    연결 방식을 정한 GMS 실측(2026-11-10)과 같은 입력이다.
    연결 후보가 없으면 전달하지 않는다.
    """
    if not items:
        return ""
    units = competency_units(job_subcategories(job.job_title))
    return f"\n\n[직무 능력단위]\n{', '.join(units)}" if units else ""


def _asked(job: PlanJob) -> str:
    """이미 출제한 질문과 같은 질문을 만들지 않게 하는 입력(AI 명세 2장 askedQuestions).

    같은 주장을 다른 측면으로 묻는 질문은 허용한다.
    같은 주장 자체를 금지하면 주장이 적은 자기소개서로는 질문 5개를 만들 수 없기 때문이다
    (11/10 GMS 실측).
    """
    if not job.asked_questions:
        return ""
    lines = "\n".join(f"- ({q.claim_id}) {q.content}" for q in job.asked_questions)
    return (
        f"\n\n[이미 출제한 질문]\n{lines}\n"
        "위 질문과 같은 질문은 만들지 않는다. "
        "같은 주장이라도 위 질문과 다른 기준이나 다른 측면을 묻는 질문은 만든다"
    )


def build_question_messages(job: PlanJob, claims: Sequence[Claim]) -> list[dict[str, str]]:
    items = company_candidates(job, claims)
    user = (
        f"회사: {job.company_name}\n직무: {job.job_title}\n\n"
        f"{_company(items)}[주장]\n{claims_text(claims)}{_asked(job)}{_units(job, items)}"
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


def check_company_links(questions: Sequence[Question], items: Sequence[CompanyItem]) -> None:
    """회사 정보와 연결한 질문 수와 연결한 항목·주장의 짝을 검사한다.

    회사 정보와 연결한 질문은 COMPANY_LINKED_MAX개 이하여야 하고,
    연결한 항목 번호는 후보 항목이어야 한다(카드에 없는 회사 정보를 전제로 묻지 않음).
    인재상 항목은 그 항목의 분류값과 인재상 기준이 같은 주장과만 연결할 수 있다(AI 명세 2장).
    """
    by_id = {item.id: item for item in items}
    linked = [q for q in questions if q.company_item is not None]
    for q in linked:
        item = by_id.get(q.company_item or "")
        if item is None:
            raise PlanOutputError("questions.companyItem이 주어진 회사 항목이 아니다")
        if item.claim_ids is not None and q.claim_id not in item.claim_ids:
            raise PlanOutputError("questions.companyItem이 연결 후보가 아닌 주장과 연결되어 있다")
    if len(linked) > COMPANY_LINKED_MAX:
        raise PlanOutputError(f"회사 정보와 연결한 질문은 0~{COMPANY_LINKED_MAX}개여야 한다")


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
    job: PlanJob, claims: Sequence[Claim], seq: int, item: CompanyItem | None = None
) -> list[dict[str, str]]:
    """seq번 질문 하나를 다시 생성하는 메시지를 반환한다.

    item은 이전 질문에 연결한 회사 항목이고, 다시 생성한 질문도 그 항목과 연결한다.
    회사 정보와 연결할 질문은 질문 5개를 생성할 때 이미 정했고, 회사 항목을 전달하면
    연결하지 않은 질문에 회사 정보가 포함될 수 있으므로 회사 항목을 전달하지 않는다.
    """
    link = f"회사 항목 {item.id}와 연결해 질문한다." if item else "회사 정보와 연결하지 않는다."
    user = (
        f"회사: {job.company_name}\n직무: {job.job_title}\n\n"
        f"{_company([item] if item else [])}[주장]\n"
        f"{claims_text(claims)}{_asked(job)}\n\n"
        f"[다시 생성할 질문]\n{seq}번 질문. 이전 질문의 claimId가 주장 목록에 없었다. {link}"
    )
    return [
        {"role": "system", "content": regenerate_system(job.persona)},
        {"role": "user", "content": user},
    ]


def request_question(
    chat: Chat, job: PlanJob, claims: Sequence[Claim], seq: int, item: CompanyItem | None = None
) -> Question:
    """GMS를 한 번 호출해 seq번 질문 하나를 다시 생성한다.

    seq는 다시 생성하는 질문의 자리이고 item은 연결할 회사 항목이므로
    GMS 출력과 관계없이 요청한 값을 사용한다.
    """
    result = chat(build_regenerate_messages(job, claims, seq, item))
    question = result.content.get("question")
    if not isinstance(question, dict):
        raise PlanOutputError("question이 객체가 아니다")
    return parse_question({**question, "seq": seq, "companyItem": item.id if item else None})
