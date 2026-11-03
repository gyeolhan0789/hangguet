"""면접관별 질문 수준·어조 지침(AI 명세 2장 면접관별 질문 수준).

질문 생성(분석 작업자)과 꼬리질문 생성(면접 에이전트, AI 명세 2.2)이 같은 지침을 사용한다.
두 프로세스가 함께 import하므로 어느 실행 진입점에도 속하지 않는 이 위치에 둔다.
회사 카드 사용 지침은 질문 생성에만 해당하므로 질문 생성 모듈에 남긴다.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from app.common.session import Persona
from app.interview.talent import (
    ALL_CRITERIA,
    EXECUTIVE_CRITERIA,
    PRACTICAL_CRITERIA,
    criteria_lines,
    joined_names,
)


@dataclass(frozen=True)
class GuideSource:
    """지침에서 질문의 근거 글을 가리키는 구절이다.

    근거 글 이름에 조사만 붙이면 「답변 주장의 약점」처럼 어색한 문장이 생기므로,
    근거 글에 따라 달라지는 구절을 각각 둔다.
    """

    # 「다음 기준 중 {revealed_in} 드러난 것」
    revealed_in: str
    # 「질문 문장은 {weak_point}의 약점을 짚는 압박 어조로」
    weak_point: str
    # 「질문 문장은 {experience}을 편하게 설명할 수 있는 말투로」
    experience: str


# 질문 생성(PLAN)의 근거 글. 값을 바꾸면 plan 프롬프트가 바뀌므로 프롬프트 버전도 올려야 한다
COVER_LETTER = GuideSource(
    revealed_in="자기소개서에",
    weak_point="자기소개서 주장",
    experience="자기소개서에 작성한 경험",
)


def _only_revealed(source: GuideSource) -> str:
    return (
        f"다음 기준 중 {source.revealed_in} 드러난 것에 대해서만 묻고, "
        "드러나지 않은 기준은 묻지 않는다\n"
    )


# 상대 면접관의 기준을 이름으로 나열해 제외해야 실무면접에서 태도를,
# 임원면접에서 기술 구조를 묻지 않는다(plan-v3 GMS 실측에서 경계를 넘는 질문이 생성됨)
def _practical(source: GuideSource) -> str:
    return (
        f"이 면접은 실무면접이다. {_only_revealed(source)}"
        f"{criteria_lines(PRACTICAL_CRITERIA)}"
        f"- 임원면접 기준({joined_names(EXECUTIVE_CRITERIA)})은 묻지 않는다\n"
        "- 신입이 자기 경험으로 답할 수 있는 수준으로 묻고, "
        "라이브러리 내부 구현·수치나 명령어 암기·코드 작성은 요구하지 않는다\n"
    )


def _executive(source: GuideSource) -> str:
    return (
        f"이 면접은 임원면접이다. {_only_revealed(source)}"
        f"{criteria_lines(EXECUTIVE_CRITERIA)}"
        f"- 실무면접 기준({joined_names(PRACTICAL_CRITERIA)})은 묻지 않는다\n"
        f"- 질문 문장은 {source.weak_point}의 약점을 짚는 압박 어조로 작성하고, "
        "지원자를 비하하거나 단정하는 표현은 쓰지 않는다\n"
        "- 기술 세부 구현, 출신 지역·가족·외모 등 직무와 무관한 개인 사항은 묻지 않는다\n"
    )


# 오리 면접관은 면접 자신감 향상이 목적이므로 12개 기준을 모두 사용하고 압박하지 않는다
def _confidence(source: GuideSource) -> str:
    return (
        f"이 면접은 자신감 연습 면접이다. {_only_revealed(source)}"
        f"{criteria_lines(ALL_CRITERIA)}"
        "- 기술 경험과 태도·가치관 경험이 모두 드러나면 두 종류를 섞어 묻는다\n"
        f"- 질문 문장은 {source.experience}을 편하게 설명할 수 있는 말투로 작성하고, "
        "약점을 짚는 압박 표현은 쓰지 않는다\n"
        "- 신입이 자기 경험으로 답할 수 있는 수준으로 묻고, "
        "라이브러리 내부 구현·수치나 명령어 암기·코드 작성은 요구하지 않는다\n"
        "- 출신 지역·가족·외모 등 직무와 무관한 개인 사항은 묻지 않는다\n"
    )


_GUIDES: Mapping[Persona, Callable[[GuideSource], str]] = {
    Persona.COFFEE_CHAT: _practical,
    Persona.DEVIL: _executive,
    Persona.DUCK: _confidence,
}


def interviewer_guide(persona: Persona, source: GuideSource) -> str:
    """면접관의 질문 기준·수준·어조 지침을 프롬프트 줄로 반환한다.

    source는 질문의 근거 글을 가리키는 구절이다(질문 생성은 COVER_LETTER).
    """
    guide = _GUIDES.get(persona)
    return "" if guide is None else guide(source)
