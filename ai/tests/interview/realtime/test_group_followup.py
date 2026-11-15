"""그룹 면접 꼬리질문 판단 프롬프트 · 출력(AI 명세 6.7)."""

from typing import Any

import pytest

from app.common.session import Persona
from app.interview.realtime.followup import COMPANY_BLOCK, Followup, FollowupOutputError
from app.interview.realtime.group_followup import (
    group_followup_messages,
    parse_group_followup,
)


def test_messages_ask_for_judgment_and_one_question() -> None:
    system, user = group_followup_messages(Persona.COFFEE_CHAT, "질문 글", "채점 기준", "답변 글")

    assert system["role"] == "system"
    assert "needed" in system["content"]
    assert "근거 · 과정 · 결과 · 본인 역할" in system["content"]
    assert user == {
        "role": "user",
        "content": "[직전 질문]\n질문 글\n\n[직전 질문의 채점 기준]\n채점 기준\n\n[답변]\n답변 글",
    }


def test_company_item_of_personal_question_is_given() -> None:
    """직전 질문이 개인 맞춤 질문이면 그 질문의 연결 회사 항목을 넣는다(AI 명세 6.7)."""
    item = {"section": "market", "summary": "배송·결제 속도가 경쟁 요소", "quote": "…"}

    user = group_followup_messages(Persona.DUCK, "질문", "기준", "답변", item)[1]["content"]

    assert COMPANY_BLOCK in user


def test_not_needed_is_none() -> None:
    assert parse_group_followup({"needed": False, "question": None}) is None


def test_needed_question_is_read() -> None:
    content = {"needed": True, "question": {"content": " 어떻게 정했나요? ", "criteria": "근거"}}

    assert parse_group_followup(content) == Followup("어떻게 정했나요?", "근거")


@pytest.mark.parametrize(
    "content",
    [
        {"needed": "true", "question": None},
        {"question": None},
        {"needed": True, "question": None},
        {"needed": True, "question": {"content": "질문", "criteria": " "}},
        {"needed": True, "question": {"criteria": "기준"}},
    ],
)
def test_wrong_output_is_error(content: dict[str, Any]) -> None:
    with pytest.raises(FollowupOutputError):
        parse_group_followup(content)
