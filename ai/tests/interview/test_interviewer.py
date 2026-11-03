"""면접관별 질문 지침(AI 명세 2장)을 질문 생성과 꼬리질문 생성이 함께 사용하는지 확인한다."""

import pytest

from app.common.session import Persona
from app.interview.interviewer import ANSWER, COVER_LETTER, interviewer_guide
from app.interview.plan.questions import question_system
from app.interview.realtime.followup import followup_system


@pytest.mark.parametrize("persona", list(Persona))
def test_question_prompt_uses_the_shared_guide(persona: Persona) -> None:
    assert interviewer_guide(persona, COVER_LETTER) in question_system(persona)


@pytest.mark.parametrize("persona", list(Persona))
def test_followup_prompt_uses_the_shared_guide(persona: Persona) -> None:
    assert interviewer_guide(persona, ANSWER) in followup_system(persona, 1)


def test_cover_letter_phrases_keep_question_generation_wording() -> None:
    """질문 생성 프롬프트(plan-v5)의 문장이 바뀌지 않았는지 확인한다."""
    executive = interviewer_guide(Persona.DEVIL, COVER_LETTER)
    confidence = interviewer_guide(Persona.DUCK, COVER_LETTER)

    assert "다음 기준 중 자기소개서에 드러난 것에 대해서만 묻고" in executive
    assert "질문 문장은 자기소개서 주장의 약점을 짚는 압박 어조로" in executive
    assert "질문 문장은 자기소개서에 작성한 경험을 편하게 설명할 수 있는 말투로" in confidence


def test_answer_phrases_point_to_the_answer() -> None:
    executive = interviewer_guide(Persona.DEVIL, ANSWER)
    confidence = interviewer_guide(Persona.DUCK, ANSWER)

    assert "다음 기준 중 답변에 드러난 것에 대해서만 묻고" in executive
    assert "압박" not in executive
    assert "- 지원자를 비하하거나 단정하는 표현은 쓰지 않는다\n" in executive
    assert "질문 문장은 답변에 담긴 경험을 편하게 설명할 수 있는 말투로" in confidence
    assert "자기소개서" not in executive + confidence
