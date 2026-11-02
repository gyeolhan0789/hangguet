"""질문·기준 생성(AI 명세 2장 STEP 02): 주장을 검증하는 질문과 질문별 채점 기준을 생성한다."""

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.common.gms import Chat
from app.common.session import MAX_SEQ, MIN_SEQ, QUESTION_COUNT, Persona
from app.interview.company import BUSINESS_TITLE, TALENT_TITLE, company_section
from app.interview.plan.llm import PlanOutputError
from app.interview.plan.rules import COMPANY_LINKED_MAX, COMPANY_LINKED_MIN
from app.interview.talent import (
    EXECUTIVE_CRITERIA,
    PRACTICAL_CRITERIA,
    criteria_lines,
    joined_names,
)
from app.worker.messages import Claim, PlanJob

_ONLY_REVEALED = (
    "다음 기준 중 자기소개서에 드러난 것에 대해서만 묻고, 드러나지 않은 기준은 묻지 않는다\n"
)

# 상대 면접관의 기준을 이름으로 나열해 제외해야 실무면접에서 태도를,
# 임원면접에서 기술 구조를 묻지 않는다(plan-v3 GMS 실측에서 경계를 넘는 질문이 생성됨)
_INTERVIEW_GUIDES: Mapping[Persona, str] = {
    Persona.COFFEE_CHAT: (
        f"이 면접은 실무면접이다. {_ONLY_REVEALED}"
        f"{criteria_lines(PRACTICAL_CRITERIA)}"
        f"- 임원면접 기준({joined_names(EXECUTIVE_CRITERIA)})은 묻지 않는다\n"
        "- 신입이 자기 경험으로 답할 수 있는 수준으로 묻고, "
        "라이브러리 내부 구현·수치나 명령어 암기·코드 작성은 요구하지 않는다\n"
        f"- [{BUSINESS_TITLE}]이 주어지면 경험과 이어지는 경우에만 "
        "경험을 회사 사업 방향·시장과 연결해 묻는다. "
        "주어지지 않은 회사 정보를 전제로 묻지 않는다\n"
    ),
    Persona.DEVIL: (
        f"이 면접은 임원면접이다. {_ONLY_REVEALED}"
        f"{criteria_lines(EXECUTIVE_CRITERIA)}"
        f"- 실무면접 기준({joined_names(PRACTICAL_CRITERIA)})은 묻지 않는다\n"
        "- 질문 문장은 자기소개서 주장의 약점을 짚는 압박 어조로 작성하고, "
        "지원자를 비하하거나 단정하는 표현은 쓰지 않는다\n"
        "- 기술 세부 구현, 출신 지역·가족·외모 등 직무와 무관한 개인 사항은 묻지 않는다\n"
        f"- [{TALENT_TITLE}]이 주어지면 자소서 주장을 회사 인재상과 연결해 묻는다. "
        "주어지지 않은 회사 정보를 전제로 묻지 않는다\n"
    ),
}


def _guide(persona: Persona) -> str:
    return _INTERVIEW_GUIDES.get(persona, "")


def question_system(persona: Persona) -> str:
    return (
        "너는 지원자의 자기소개서 주장을 검증하는 면접 질문을 생성한다. "
        "주어진 주장에 없는 경험을 전제로 질문하지 않는다.\n"
        f"{_guide(persona)}"
        "- targetClaims: 질문을 생성하기 전에 위 기준 중 하나 이상이 드러난 주장을 고른다. "
        "주장마다 claimId, 드러난 기준 이름(criterion), "
        "그 기준이 드러난 자기소개서 표현(evidence)을 작성한다. "
        "기준이 드러나지 않은 주장은 넣지 않는다\n"
        f"- questions: 정확히 {QUESTION_COUNT}개, seq는 {MIN_SEQ}부터 {MAX_SEQ}까지 하나씩\n"
        "- claimId: targetClaims에 있는 주장의 id만 그대로 작성한다. "
        f"targetClaims가 {QUESTION_COUNT}개보다 적으면 "
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
        '{"targetClaims": [{"claimId": str, "criterion": str, "evidence": str}], '
        '"questions": [{"seq": int, "content": str, "criteria": str, "claimId": str, '
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
class TargetClaim:
    """면접관 기준이 드러난 주장. GMS 응답 안에서만 사용하고 플랜에는 저장하지 않는다."""

    claim_id: str
    criterion: str
    evidence: str


@dataclass(frozen=True)
class QuestionSet:
    questions: tuple[Question, ...]
    # GMS 응답의 모델 이름이다
    model: str
    targets: tuple[TargetClaim, ...] = ()


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


def parse_target(item: Any) -> TargetClaim:
    if not isinstance(item, dict):
        raise PlanOutputError("targetClaims 항목이 객체가 아니다")
    return TargetClaim(
        _text(item, "claimId", "targetClaims"),
        _text(item, "criterion", "targetClaims"),
        _text(item, "evidence", "targetClaims"),
    )


def parse_targets(content: dict[str, Any]) -> tuple[TargetClaim, ...]:
    """대상 주장 항목의 형식만 검사한다.

    주장 id와 기준 이름은 결과 검증 단계가 검사한다.
    """
    raw = content.get("targetClaims")
    if not isinstance(raw, list):
        raise PlanOutputError("targetClaims가 목록이 아니다")
    return tuple(parse_target(item) for item in raw)


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
    return QuestionSet(parse_questions(result.content), result.model, parse_targets(result.content))


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
