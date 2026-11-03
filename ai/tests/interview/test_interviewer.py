"""면접관별 질문 지침(AI 명세 2장)을 질문 생성이 공용 모듈에서 가져오는지 확인한다."""

import pytest

from app.common.session import Persona
from app.interview.interviewer import COVER_LETTER, interviewer_guide
from app.interview.plan.questions import question_system


@pytest.mark.parametrize("persona", list(Persona))
def test_question_prompt_uses_the_shared_guide(persona: Persona) -> None:
    assert interviewer_guide(persona, COVER_LETTER) in question_system(persona)


def test_cover_letter_phrases_keep_question_generation_wording() -> None:
    """질문 생성 프롬프트(plan-v5)의 문장이 바뀌지 않았는지 확인한다."""
    executive = interviewer_guide(Persona.DEVIL, COVER_LETTER)
    confidence = interviewer_guide(Persona.DUCK, COVER_LETTER)

    assert "다음 기준 중 자기소개서에 드러난 것에 대해서만 묻고" in executive
    assert "질문 문장은 자기소개서 주장의 약점을 짚는 압박 어조로" in executive
    assert "질문 문장은 자기소개서에 작성한 경험을 편하게 설명할 수 있는 말투로" in confidence
