import pytest
from company_taxonomy.talent_criteria import EXECUTIVE_CRITERIA, PRACTICAL_CRITERIA

from app.common.session import Persona
from app.interview.talent import (
    criteria_lines,
    criteria_names,
    joined_names,
)

# 기준: AI 명세 2장 면접관별 인재상 기준. 프롬프트에 그대로 포함되므로 문구 전체를 검사한다
PRACTICAL_LINES = (
    "- 전문성·성장: 경험한 기술의 구조(구성 요소의 역할, 데이터 흐름, 설계를 선택한 이유와 대안, "
    "변경 시 영향 범위), 새로 배운 것과 배운 방법\n"
    "- 도전·혁신: 새로운 시도·기술 도입의 이유, 대안, 결과\n"
    "- 실행·성과: 성과 수치의 근거와 본인 역할\n"
    "- 고객·사용자 중심: 기술 선택·구현이 사용자 경험에 준 영향\n"
    "- 유연·적응·개방: 요구사항·환경 변화에 대응한 방법\n"
    "- 성실·정확·품질: 오류를 줄이거나 품질을 확인한 방법\n"
)
EXECUTIVE_LINES = (
    "- 정직·윤리·공정: 성과와 원칙이 부딪힌 상황에서의 판단\n"
    "- 책임·주도성: 실패·위기에서 본인이 진 책임과 그 뒤의 행동\n"
    "- 협력·소통: 의견이 다른 사람과 일한 방식\n"
    "- 존중·배려: 동료·상대를 대한 태도\n"
    "- 글로벌·다양성 이해: 배경이 다른 사람과 일한 경험\n"
    "- 사회적 책임·공공성: 일이 사회·공공에 미치는 영향에 대한 생각\n"
)


def test_criteria_lines_list_name_and_what_to_ask() -> None:
    assert criteria_lines(PRACTICAL_CRITERIA) == PRACTICAL_LINES
    assert criteria_lines(EXECUTIVE_CRITERIA) == EXECUTIVE_LINES


def test_joined_names_lists_names_in_order() -> None:
    assert joined_names(EXECUTIVE_CRITERIA) == (
        "정직·윤리·공정, 책임·주도성, 협력·소통, 존중·배려, 글로벌·다양성 이해, 사회적 책임·공공성"
    )


@pytest.mark.parametrize(
    ("persona", "lines"),
    [(Persona.COFFEE_CHAT, PRACTICAL_LINES), (Persona.DEVIL, EXECUTIVE_LINES)],
)
def test_criteria_names_match_interviewer(persona: Persona, lines: str) -> None:
    expected = {line.removeprefix("- ").split(":")[0] for line in lines.splitlines()}

    assert criteria_names(persona) == expected
