from dataclasses import replace
from typing import Any

import pytest

from app.common.session import QUESTION_COUNT, Persona
from app.interview.plan.llm import PlanOutputError
from app.interview.plan.questions import (
    Question,
    build_question_messages,
    build_regenerate_messages,
    parse_questions,
    request_questions,
)
from app.worker.messages import AskedQuestion, Claim, ClaimType
from tests.interview.plan.fakes import JOB, FakeChat, question

CLAIMS = (
    Claim("c1", "주문 조회 응답 시간을 40% 줄였다", ClaimType.NUMBER, 4),
    Claim("c2", "캐시 계층을 설계했다", ClaimType.EXPERIENCE, 5),
)


def test_question_count_matches_spec() -> None:
    """AI 명세 2장: 질문은 seq 1~5로 정확히 5개다."""
    assert QUESTION_COUNT == 5


def test_messages_list_claims_with_ids() -> None:
    messages = build_question_messages(JOB, CLAIMS)

    assert [m["role"] for m in messages] == ["system", "user"]
    assert "정확히 5개, seq는 1부터 5까지 하나씩" in messages[0]["content"]
    assert messages[1]["content"] == (
        "회사: ○○전자\n직무: 백엔드 개발자\n\n[주장]\n"
        "c1 (NUMBER, 문장 4) 주문 조회 응답 시간을 40% 줄였다\n"
        "c2 (EXPERIENCE, 문장 5) 캐시 계층을 설계했다"
    )


# 기준: AI 명세 2장 면접관별 인재상 기준(개발자 면접관 = 실무면접, 악마 면접관 = 임원면접)
ONLY_REVEALED = (
    "다음 기준 중 자기소개서에 드러난 것에 대해서만 묻고, 드러나지 않은 기준은 묻지 않는다"
)
PRACTICAL_CRITERIA = (
    "전문성·성장",
    "도전·혁신",
    "실행·성과",
    "고객·사용자 중심",
    "유연·적응·개방",
    "성실·정확·품질",
)
EXECUTIVE_CRITERIA = (
    "정직·윤리·공정",
    "책임·주도성",
    "협력·소통",
    "존중·배려",
    "글로벌·다양성 이해",
    "사회적 책임·공공성",
)
PRACTICAL_EXCLUDED = "라이브러리 내부 구현·수치나 명령어 암기·코드 작성은 요구하지 않는다"
PRESSURE_TONE = "질문 문장은 자기소개서 주장의 약점을 짚는 압박 어조로 작성"
NO_BELITTLING = "지원자를 비하하거나 단정하는 표현은 쓰지 않는다"
EXCLUDE_EXECUTIVE = f"- 임원면접 기준({', '.join(EXECUTIVE_CRITERIA)})은 묻지 않는다"
EXCLUDE_PRACTICAL = f"- 실무면접 기준({', '.join(PRACTICAL_CRITERIA)})은 묻지 않는다"
CLAIM_FROM_LIST = "- claimId: 주장 목록에 있는 주장의 id만 그대로 작성한다"
SPLIT_BY_CRITERIA = (
    "주장이 5개보다 적으면 같은 주장을 위 기준 중 다른 기준으로 나누어 다시 질문하고"
)


@pytest.mark.parametrize("persona", list(Persona))
def test_questions_use_only_given_claims(persona: Persona) -> None:
    """면접관 기준이 드러난 주장은 코드가 먼저 고르므로(AI 명세 2장 면접관별 주장 선택)
    질문 생성 모델에는 주어진 주장으로만 질문하게 하고 주장을 다시 고르게 하지 않는다.
    """
    system = build_question_messages(replace(JOB, persona=persona), CLAIMS)[0]["content"]

    assert CLAIM_FROM_LIST in system
    assert SPLIT_BY_CRITERIA in system
    assert "targetClaims" not in system


def system_prompts(persona: Persona) -> tuple[str, str]:
    """처음 생성과 질문 하나를 다시 생성할 때의 시스템 프롬프트를 반환한다."""
    job = replace(JOB, persona=persona)
    return (
        build_question_messages(job, CLAIMS)[0]["content"],
        build_regenerate_messages(job, CLAIMS, 3)[0]["content"],
    )


@pytest.mark.parametrize("system", system_prompts(Persona.COFFEE_CHAT))
def test_coffee_chat_questions_use_practical_criteria(system: str) -> None:
    assert "이 면접은 실무면접이다" in system
    assert ONLY_REVEALED in system
    assert all(f"- {name}:" in system for name in PRACTICAL_CRITERIA)
    assert not any(f"- {name}:" in system for name in EXECUTIVE_CRITERIA)
    assert EXCLUDE_EXECUTIVE in system
    assert PRACTICAL_EXCLUDED in system


@pytest.mark.parametrize("system", system_prompts(Persona.DEVIL))
def test_devil_questions_use_executive_criteria(system: str) -> None:
    assert "이 면접은 임원면접이다" in system
    assert ONLY_REVEALED in system
    assert all(f"- {name}:" in system for name in EXECUTIVE_CRITERIA)
    assert not any(f"- {name}:" in system for name in PRACTICAL_CRITERIA)
    assert EXCLUDE_PRACTICAL in system
    assert PRESSURE_TONE in system
    assert NO_BELITTLING in system


DUCK_MIXED = "- 기술 경험과 태도·가치관 경험이 모두 드러나면 두 종류를 섞어 묻는다"
DUCK_TONE = (
    "질문 문장은 자기소개서에 작성한 경험을 편하게 설명할 수 있는 말투로 작성하고, "
    "약점을 짚는 압박 표현은 쓰지 않는다"
)


@pytest.mark.parametrize("system", system_prompts(Persona.DUCK))
def test_duck_questions_use_all_criteria_without_pressure(system: str) -> None:
    """오리 면접관은 자신감 연습이 목적이므로 12개 기준을 모두 쓰고 압박하지 않는다(AI 명세 2장)."""
    assert "이 면접은 자신감 연습 면접이다" in system
    assert ONLY_REVEALED in system
    assert all(f"- {name}:" in system for name in (*PRACTICAL_CRITERIA, *EXECUTIVE_CRITERIA))
    assert DUCK_MIXED in system
    assert DUCK_TONE in system
    assert PRACTICAL_EXCLUDED in system
    assert PRESSURE_TONE not in system
    assert "기준(" not in system


def test_parses_questions() -> None:
    content = {"questions": [question(1), {**question(2, "c2"), "content": " 캐시를 왜? "}]}

    assert parse_questions(content) == (
        Question(1, "1번 질문의 근거는 무엇인가?", "원인 분석 · 수치 근거", "c1"),
        Question(2, "캐시를 왜?", "원인 분석 · 수치 근거", "c2"),
    )


def test_parse_keeps_count_and_seq_as_received() -> None:
    """질문 수와 seq는 결과 검증 단계가 검사하므로 형식 검사에서는 그대로 유지한다."""
    content = {"questions": [question(seq) for seq in (9, 9, 0)]}

    assert [q.seq for q in parse_questions(content)] == [9, 9, 0]


@pytest.mark.parametrize(
    "content",
    [
        {},
        {"questions": {"seq": 1}},
        {"questions": ["질문"]},
        {"questions": [question("1")]},
        {"questions": [question(True)]},
        {"questions": [question(1.0)]},
        {"questions": [{**question(1), "content": " "}]},
        {"questions": [{**question(1), "criteria": None}]},
        {"questions": [{**question(1), "claimId": 1}]},
        {"questions": [question(1), "질문"]},
    ],
)
def test_broken_question_is_output_error(content: dict[str, Any]) -> None:
    with pytest.raises(PlanOutputError):
        parse_questions(content)


# 기준: AI 명세 2장 askedQuestions(같은 지원서·같은 면접관의 면접에서 출제한 보관함 질문)
ASKED_JOB = replace(
    JOB,
    asked_questions=(
        AskedQuestion("응답 시간을 40% 줄인 과정은?", "c1"),
        AskedQuestion("캐시 계층의 구조는?", "c2"),
    ),
)
ASKED_SECTION = (
    "[이미 출제한 질문]\n"
    "- (c1) 응답 시간을 40% 줄인 과정은?\n"
    "- (c2) 캐시 계층의 구조는?\n"
    "위 질문과 같은 질문은 만들지 않는다. "
    "같은 주장이라도 위 질문과 다른 기준이나 다른 측면을 묻는 질문은 만든다"
)


def test_question_messages_list_asked_questions_not_to_repeat() -> None:
    """출제한 질문과 같은 질문은 만들지 않고, 같은 주장을 다른 측면으로 묻는 질문은 만든다."""
    user = build_question_messages(ASKED_JOB, CLAIMS)[1]["content"]

    assert user.endswith(ASKED_SECTION)


def test_regenerate_messages_also_list_asked_questions() -> None:
    """질문 하나를 다시 생성할 때도 출제한 질문과 같은 질문을 만들지 않게 한다."""
    user = build_regenerate_messages(ASKED_JOB, CLAIMS, 3)[1]["content"]

    assert ASKED_SECTION in user


def test_question_messages_without_asked_questions_have_no_section() -> None:
    user = build_question_messages(JOB, CLAIMS)[1]["content"]

    assert "[이미 출제한 질문]" not in user


def test_request_questions_calls_gms_once_and_keeps_model() -> None:
    chat = FakeChat([{"questions": [question(s) for s in range(1, 6)]}])

    result = request_questions(chat, JOB, CLAIMS)

    assert chat.calls == [build_question_messages(JOB, CLAIMS)]
    assert [q.seq for q in result.questions] == [1, 2, 3, 4, 5]
    assert result.model == "gms-served"


# 기준: AI 명세 2장 회사 카드 사용
# (악마 면접관은 인재상, 개발자 면접관은 사업 방향·시장, 오리 면접관은 둘 다)
CARD: dict[str, Any] = {
    "talent": [{"title": "해결", "details": ["스스로 문제를 정의하고 해결한다"]}],
    "direction": [{"summary": "해외 결제 확대"}],
    "market": [],
}
COMPANY_RULES = {
    Persona.DEVIL: "- [회사 인재상]이 주어지면 자소서 주장을 회사 인재상과 연결해 묻는다",
    Persona.COFFEE_CHAT: (
        "- [회사 사업 방향·시장]이 주어지면 경험과 이어지는 경우에만 "
        "경험을 회사 사업 방향·시장과 연결해 묻는다"
    ),
    Persona.DUCK: (
        "- [회사 인재상]이나 [회사 사업 방향·시장]이 주어지면 "
        "자소서 경험과 이어지는 경우에만 회사 정보와 연결해 묻는다"
    ),
}
NO_INVENTED_COMPANY = "주어지지 않은 회사 정보를 전제로 묻지 않는다"
COMPANY_SECTIONS = {
    Persona.DEVIL: "[회사 인재상]\nco1 해결: 스스로 문제를 정의하고 해결한다\n\n[주장]\n",
    Persona.COFFEE_CHAT: "[회사 사업 방향·시장]\nco1 사업 방향: 해외 결제 확대\n\n[주장]\n",
    # 오리 면접관은 두 구역을 모두 사용하고 번호를 이어서 매긴다
    Persona.DUCK: (
        "[회사 인재상]\nco1 해결: 스스로 문제를 정의하고 해결한다\n\n"
        "[회사 사업 방향·시장]\nco2 사업 방향: 해외 결제 확대\n\n[주장]\n"
    ),
}


@pytest.mark.parametrize("persona", list(Persona))
def test_company_card_is_sent_for_interviewer(persona: Persona) -> None:
    """처음 생성과 질문 하나를 다시 생성할 때 모두 면접관이 사용할 회사 정보를 전송한다."""
    job = replace(JOB, persona=persona, company_card=CARD)

    for messages in (
        build_question_messages(job, CLAIMS),
        build_regenerate_messages(job, CLAIMS, 3),
    ):
        assert COMPANY_RULES[persona] in messages[0]["content"]
        assert NO_INVENTED_COMPANY in messages[0]["content"]
        assert COMPANY_SECTIONS[persona] in messages[1]["content"]


@pytest.mark.parametrize("persona", list(Persona))
def test_no_company_section_without_card(persona: Persona) -> None:
    job = replace(JOB, persona=persona)

    user = build_question_messages(job, CLAIMS)[1]["content"]

    assert user == (
        "회사: ○○전자\n직무: 백엔드 개발자\n\n[주장]\n"
        "c1 (NUMBER, 문장 4) 주문 조회 응답 시간을 40% 줄였다\n"
        "c2 (EXPERIENCE, 문장 5) 캐시 계층을 설계했다"
    )


# 개발자 면접관은 경험과 이어지지 않으면 회사 정보와 연결하지 않아도 된다
COMPANY_ITEM_COUNTS = {
    Persona.DEVIL: "1~2개",
    Persona.COFFEE_CHAT: "0~2개",
    Persona.DUCK: "0~2개",
}
COMPANY_ITEM_RULE = (
    "질문만 회사 정보와 연결하고, 연결한 질문에는 연결한 회사 항목 번호를 그대로 작성한다. "
    "질문 내용이 회사 정보를 다루지 않으면 연결하지 않는다"
)


@pytest.mark.parametrize("persona", list(Persona))
def test_questions_name_linked_company_item(persona: Persona) -> None:
    system = build_question_messages(replace(JOB, persona=persona), CLAIMS)[0]["content"]
    rule = f"- companyItem: 회사 정보가 주어지면 {COMPANY_ITEM_COUNTS[persona]} {COMPANY_ITEM_RULE}"

    assert rule in system
    assert '"companyItem": str' in system


@pytest.mark.parametrize(
    ("value", "expected"), [(..., None), (None, None), ("", None), (" ", None), (" co1 ", "co1")]
)
def test_company_item_is_optional(value: Any, expected: str | None) -> None:
    item = question(1) if value is ... else {**question(1), "companyItem": value}

    assert parse_questions({"questions": [item]})[0].company_item == expected


def test_company_item_that_is_not_text_is_output_error() -> None:
    content = {"questions": [{**question(1), "companyItem": 1}]}
    with pytest.raises(PlanOutputError):
        parse_questions(content)
