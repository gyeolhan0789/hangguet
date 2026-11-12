"""면접관별 인재상 기준(AI 명세 2장). 질문 생성과 피드백 작성이 같은 기준을 사용한다.

기준 목록은 회사 카드 파이프라인과 함께 사용하므로 공용 패키지(company_taxonomy)에 있고,
이 모듈은 면접관별 기준과 프롬프트용 문자열을 제공한다. 기준은 (기준 이름, 묻는 것)의 쌍이다.
"""

from collections.abc import Mapping, Sequence

from company_taxonomy.talent_criteria import EXECUTIVE_CRITERIA, PRACTICAL_CRITERIA, TALENT_CRITERIA

from app.common.session import Persona

Criteria = Sequence[tuple[str, str]]

# 오리 면접관은 면접 자신감 향상이 목적이므로 기준을 나누지 않고 12개 기준을 모두 사용한다
ALL_CRITERIA: Criteria = TALENT_CRITERIA

_CRITERIA_BY_PERSONA: Mapping[Persona, Criteria] = {
    Persona.COFFEE_CHAT: PRACTICAL_CRITERIA,
    Persona.DEVIL: EXECUTIVE_CRITERIA,
    Persona.DUCK: ALL_CRITERIA,
}


def criteria_lines(criteria: Criteria) -> str:
    """프롬프트에 포함할 기준 목록을 「- 기준 이름: 묻는 것」 한 줄씩 반환한다."""
    return "".join(f"- {name}: {asks}\n" for name, asks in criteria)


def joined_names(criteria: Criteria) -> str:
    """기준 이름을 쉼표로 연결해 반환한다. 상대 면접관의 기준을 제외하라고 지시할 때 사용한다."""
    return ", ".join(name for name, _ in criteria)


def criteria_names(persona: Persona) -> frozenset[str]:
    """면접관의 인재상 기준 이름을 반환한다. 모델이 작성한 기준 이름을 검사할 때 사용한다."""
    return frozenset(name for name, _ in _CRITERIA_BY_PERSONA.get(persona, ()))
