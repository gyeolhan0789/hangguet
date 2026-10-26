"""판정 단계의 고정 점수와 확률 기대값을 계산한다(AI 명세 3장)."""

from collections.abc import Mapping
from decimal import Decimal
from enum import StrEnum
from types import MappingProxyType

from app.common.rounding import round_half_up_int

LEVEL_SCORES: Mapping[int, int] = MappingProxyType({1: 50, 2: 70, 3: 90})


class ScoreMethod(StrEnum):
    PROBABILITY = "PROBABILITY"
    FIXED = "FIXED"


class LevelOutOfRangeError(ValueError):
    """판정 단계가 허용 범위를 벗어났다."""


def _require_level(level: int) -> int:
    # bool은 int의 하위 형식이므로 True가 1단계로 처리되지 않도록 한다.
    if type(level) is not int or level not in LEVEL_SCORES:
        raise LevelOutOfRangeError(f"허용되지 않은 판정 단계: {level!r}")
    return level


def fixed_score(level: int) -> int:
    return LEVEL_SCORES[_require_level(level)]


def expected_score(probs: Mapping[int, float]) -> int:
    """단계별 확률을 정규화한 기대값을 사사오입한다."""
    for level in probs:
        _require_level(level)
    # 이진 실수 오차로 반올림 경계가 변경되지 않도록 십진수로 계산한다.
    weights = {level: Decimal(str(probability)) for level, probability in probs.items()}
    total = sum(weights.values(), Decimal(0))
    if total <= 0:
        raise ValueError("판정 단계 확률의 합은 양수여야 한다")
    # 상위 확률에는 단계 외 토큰도 포함되므로 단계에 해당하는 확률 합으로 나눈다.
    value = sum((weight * LEVEL_SCORES[level] for level, weight in weights.items()), Decimal(0))
    return round_half_up_int(value / total)
