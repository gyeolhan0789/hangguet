"""면접관별 인재상 기준(AI 명세 2장). 질문 생성과 피드백 작성이 같은 기준을 사용한다.

기준은 (기준 이름, 묻는 것)의 쌍이다.
"""

from collections.abc import Mapping, Sequence

from app.common.session import Persona

Criteria = Sequence[tuple[str, str]]

# 개발자 면접관(실무면접)
PRACTICAL_CRITERIA: Criteria = (
    (
        "전문성·성장",
        "경험한 기술의 구조(구성 요소의 역할, 데이터 흐름, 설계를 선택한 이유와 대안, "
        "변경 시 영향 범위), 새로 배운 것과 배운 방법",
    ),
    ("도전·혁신", "새로운 시도·기술 도입의 이유, 대안, 결과"),
    ("실행·성과", "성과 수치의 근거와 본인 역할"),
    ("고객·사용자 중심", "기술 선택·구현이 사용자 경험에 준 영향"),
    ("유연·적응·개방", "요구사항·환경 변화에 대응한 방법"),
    ("성실·정확·품질", "오류를 줄이거나 품질을 확인한 방법"),
)
# 악마 면접관(임원면접)
EXECUTIVE_CRITERIA: Criteria = (
    ("정직·윤리·공정", "성과와 원칙이 부딪힌 상황에서의 판단"),
    ("책임·주도성", "실패·위기에서 본인이 진 책임과 그 뒤의 행동"),
    ("협력·소통", "의견이 다른 사람과 일한 방식"),
    ("존중·배려", "동료·상대를 대한 태도"),
    ("글로벌·다양성 이해", "배경이 다른 사람과 일한 경험"),
    ("사회적 책임·공공성", "일이 사회·공공에 미치는 영향에 대한 생각"),
)

_CRITERIA_BY_PERSONA: Mapping[Persona, Criteria] = {
    Persona.COFFEE_CHAT: PRACTICAL_CRITERIA,
    Persona.DEVIL: EXECUTIVE_CRITERIA,
}


def criteria_lines(criteria: Criteria) -> str:
    """프롬프트에 포함할 기준 목록을 「- 기준 이름: 묻는 것」 한 줄씩 반환한다."""
    return "".join(f"- {name}: {asks}\n" for name, asks in criteria)


def joined_names(criteria: Criteria) -> str:
    """기준 이름을 쉼표로 연결해 반환한다. 상대 면접관의 기준을 제외하라고 지시할 때 사용한다."""
    return ", ".join(name for name, _ in criteria)


def criteria_names(persona: Persona) -> frozenset[str]:
    """면접관이 묻는 인재상 기준 이름을 반환한다. targetClaims의 criterion을 검사할 때 사용한다."""
    return frozenset(name for name, _ in _CRITERIA_BY_PERSONA.get(persona, ()))
