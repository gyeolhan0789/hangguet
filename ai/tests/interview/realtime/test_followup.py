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
    assert FOLLOWUP_PROMPT_VERSION == "followup-v1"


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
    assert "답변과 직전 질문에 없는 사실을 전제로 질문하지 않는다" in system


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
