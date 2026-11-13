"""꼬리질문 생성 규칙(AI 명세 2.2)의 요청 메시지와 출력 검증."""

import math
from typing import Any

import pytest
from company_taxonomy.talent_criteria import EXECUTIVE_CRITERIA, PRACTICAL_CRITERIA

from app.common.session import Persona
from app.interview.interviewer import ANSWER, interviewer_guide
from app.interview.realtime.followup import (
    FOLLOWUP_PROMPT_VERSION,
    FOLLOWUP_SEQS,
    FOLLOWUP_TIMEOUT,
    Followup,
    FollowupOutputError,
    followup_messages,
    parse_followups,
)
from app.interview.talent import joined_names


def test_order_and_limits_follow_spec() -> None:
    # 1번 답변 뒤 2번, 3번 답변 뒤 4·5번을 한 번에 생성한다
    assert dict(FOLLOWUP_SEQS) == {1: (2,), 3: (4, 5)}
    assert math.isclose(FOLLOWUP_TIMEOUT, 4.0)
    assert FOLLOWUP_PROMPT_VERSION == "followup-v2"


def test_messages_carry_previous_question_criteria_and_answer() -> None:
    system, user = followup_messages(Persona.DEVIL, "질문 글", "채점 기준", "답변 글", 1)

    assert (system["role"], user["role"]) == ("system", "user")
    assert user["content"] == (
        "[직전 질문]\n질문 글\n\n[직전 질문의 채점 기준]\n채점 기준\n\n[답변]\n답변 글"
    )


@pytest.mark.parametrize("persona", list(Persona))
def test_system_uses_same_interviewer_guide_as_question_generation(persona: Persona) -> None:
    """면접관별 질문 수준과 인재상 기준은 질문 생성과 같다(AI 명세 2.2 생성 지침)."""
    system = followup_messages(persona, "질문", "기준", "답변", 1)[0]["content"]

    assert interviewer_guide(persona, ANSWER) in system
    assert "한 질문에서 한 가지만 묻는다" in system
    assert (
        "답변, 직전 질문, 그 질문의 연결 회사 정보에 없는 사실을 전제로 질문하지 않는다" in system
    )
    assert (
        "- [직전 질문과 연결한 회사 정보]가 주어지면 "
        "답변이 그 회사 정보와 이어지는 지점을 파고들 수 있다" in system
    )


@pytest.mark.parametrize(
    ("item", "text"),
    [
        (
            {"section": "talent", "title": "주도적 실행", "parent": "책임", "details": ["끝까지"]},
            "주도적 실행(책임): 끝까지",
        ),
        (
            {"section": "direction", "summary": "해외 결제 확대", "quote": "확대할 계획이다"},
            "사업 방향: 해외 결제 확대 (원문: 확대할 계획이다)",
        ),
        (
            {"section": "recent", "summary": "새 서비스 출시", "published": "2026-10-30"},
            "2026-10-30: 새 서비스 출시",
        ),
    ],
    ids=["talent", "direction", "recent"],
)
def test_company_item_is_added_as_question_generation_text(item: dict[str, Any], text: str) -> None:
    """연결 회사 항목은 질문 생성 프롬프트와 같은 글로 답변 뒤에 전달한다(AI 명세 2.2 입력)."""
    user = followup_messages(Persona.DUCK, "질문", "기준", "답변", 1, item)[1]["content"]

    assert user == (
        "[직전 질문]\n질문\n\n[직전 질문의 채점 기준]\n기준\n\n[답변]\n답변"
        f"\n\n[직전 질문과 연결한 회사 정보]\n{text}"
    )


@pytest.mark.parametrize(
    "item",
    [None, {"section": "unknown", "summary": "모르는 칸"}, {"summary": "칸 이름 없음"}],
    ids=["unlinked", "unknown-section", "no-section"],
)
def test_company_block_is_omitted_without_item_text(item: dict[str, Any] | None) -> None:
    user = followup_messages(Persona.DUCK, "질문", "기준", "답변", 1, item)[1]["content"]

    assert "[직전 질문과 연결한 회사 정보]" not in user


def test_practical_and_executive_guides_exclude_each_other() -> None:
    practical = followup_messages(Persona.COFFEE_CHAT, "질문", "기준", "답변", 1)[0]["content"]
    executive = followup_messages(Persona.DEVIL, "질문", "기준", "답변", 1)[0]["content"]

    assert f"임원면접 기준({joined_names(EXECUTIVE_CRITERIA)})은 묻지 않는다" in practical
    assert f"실무면접 기준({joined_names(PRACTICAL_CRITERIA)})은 묻지 않는다" in executive
    assert "압박 어조" not in executive


def test_only_two_questions_are_asked_for_different_aspects() -> None:
    one = followup_messages(Persona.DUCK, "질문", "기준", "답변", 1)[0]["content"]
    two = followup_messages(Persona.DUCK, "질문", "기준", "답변", 2)[0]["content"]

    assert "questions: 정확히 1개" in one
    assert "questions: 정확히 2개" in two
    assert "서로 다른 측면" not in one
    assert "서로 다른 측면" in two


def test_parses_requested_number_of_questions_with_trimmed_text() -> None:
    content = {
        "questions": [
            {"content": " 첫 질문 ", "criteria": " 첫 기준 "},
            {"content": "둘째 질문", "criteria": "둘째 기준"},
        ]
    }

    assert parse_followups(content, 2) == (
        Followup("첫 질문", "첫 기준"),
        Followup("둘째 질문", "둘째 기준"),
    )


@pytest.mark.parametrize(
    "content",
    [
        pytest.param({}, id="no-questions"),
        pytest.param({"questions": "질문"}, id="not-list"),
        pytest.param({"questions": [{"content": "질문", "criteria": "기준"}]}, id="count-short"),
        pytest.param({"questions": [{"content": "질문", "criteria": "기준"}] * 3}, id="count-over"),
        pytest.param({"questions": ["질문", "질문"]}, id="item-not-object"),
        pytest.param(
            {
                "questions": [
                    {"content": "질문", "criteria": "기준"},
                    {"content": " ", "criteria": "기준"},
                ]
            },
            id="blank-content",
        ),
        pytest.param(
            {"questions": [{"content": "질문", "criteria": "기준"}, {"content": "질문"}]},
            id="no-criteria",
        ),
        pytest.param(
            {
                "questions": [
                    {"content": "질문", "criteria": "기준"},
                    {"content": 1, "criteria": "기준"},
                ]
            },
            id="content-not-text",
        ),
    ],
)
def test_invalid_output_is_rejected(content: dict[str, Any]) -> None:
    with pytest.raises(FollowupOutputError):
        parse_followups(content, 2)
