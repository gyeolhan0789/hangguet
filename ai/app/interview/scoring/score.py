"""판정 단계의 고정 점수를 계산한다(AI 명세 3장)."""

from collections.abc import Mapping
from enum import StrEnum
from types import MappingProxyType

LEVEL_SCORES: Mapping[int, int] = MappingProxyType({1: 50, 2: 70, 3: 90})


class ScoreMethod(StrEnum):
    # 새 채점은 FIXED만 기록한다.
    # 이전에 확률 기대값으로 채점해 저장된 답변이 결과 생성 작업 메시지로 다시 전달되므로
    # 저장된 evaluation 검사에서 PROBABILITY도 허용한다
    PROBABILITY = "PROBABILITY"
    FIXED = "FIXED"


class LevelOutOfRangeError(ValueError):
    """판정 단계가 허용 범위를 벗어났다."""


def fixed_score(level: int) -> int:
    # bool은 int의 하위 형식이므로 True가 1단계로 처리되지 않도록 한다.
    if type(level) is not int or level not in LEVEL_SCORES:
        raise LevelOutOfRangeError(f"허용되지 않은 판정 단계: {level!r}")
    return LEVEL_SCORES[level]
