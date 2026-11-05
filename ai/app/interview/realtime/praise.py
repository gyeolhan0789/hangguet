"""오리 면접관이 답변 뒤에 발화할 칭찬 한 문장을 선택한다(AI 명세 6.2 호응).

답변 중에 수신한 마지막 리액션 판단(6.4)으로 선택한다.
판단이 없으면 PRAISE_TEXTS의 NO_JUDGMENT를 사용한다.
"""

from collections.abc import Mapping
from enum import StrEnum

from app.interview.realtime.reaction import Judgment


class Praise(StrEnum):
    """칭찬 종류.

    값은 미리 합성한 음성 파일 이름이다.
    """

    NO_JUDGMENT = "no_judgment"
    EFFORT = "effort"
    TRUST = "trust"
    INTEREST = "interest"
    SMILE = "smile"
    NOD = "nod"
    DEFAULT = "default"


# AI 명세 6.2 칭찬 표의 문장이다.
# 문장을 변경하면 app/agent/duck_praise의 음성 파일도 다시 합성한다
PRAISE_TEXTS: Mapping[Praise, str] = {
    Praise.NO_JUDGMENT: "잘하고 있어요.",
    Praise.EFFORT: "끝까지 차분하게 말씀해 주셨어요.",
    Praise.TRUST: "근거까지 잘 설명해 주셨어요.",
    Praise.INTEREST: "경험을 구체적으로 들려주셨네요.",
    Praise.SMILE: "좋은 내용이었어요.",
    Praise.NOD: "핵심을 잘 짚어 주셨어요.",
    Praise.DEFAULT: "잘 들었어요, 고마워요.",
}
# AI 명세 6.2 기준값(임시 값): 관심·신뢰 단계 3(0~1 환산 0.75) 이상
STRONG_ATTITUDE = 0.75
# AI 명세 6.2 기준값(임시 값): 관심·신뢰가 모두 단계 2(0.5) 미만이면 부정적 판단이다
WEAK_ATTITUDE = 0.5
NEGATIVE_REACTIONS = frozenset({"frown", "smirk", "tilt"})


def choose_praise(judgment: Judgment | None) -> Praise:
    """AI 명세 6.2 칭찬 표를 위에서부터 확인해 처음 해당하는 칭찬을 반환한다."""
    if judgment is None:
        return Praise.NO_JUDGMENT
    reaction = judgment.reaction.value if judgment.reaction is not None else None
    attitude = judgment.attitude
    if reaction in NEGATIVE_REACTIONS or (
        attitude.interest < WEAK_ATTITUDE and attitude.trust < WEAK_ATTITUDE
    ):
        return Praise.EFFORT
    if attitude.trust >= STRONG_ATTITUDE:
        return Praise.TRUST
    if attitude.interest >= STRONG_ATTITUDE:
        return Praise.INTEREST
    if reaction == "smile":
        return Praise.SMILE
    if reaction == "nod":
        return Praise.NOD
    return Praise.DEFAULT
