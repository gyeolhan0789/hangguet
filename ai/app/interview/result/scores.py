"""답변별 점수와 면접 항목별 평균을 계산한다(AI 명세 4장)."""

from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import Any

from app.common.rounding import round_half_up_int
from app.interview.scoring.judge import Criterion

Criteria = Mapping[str, Mapping[str, Any]]


class MissingCriterionError(ValueError):
    """필수 평가 항목에 유효한 정수 점수가 없다."""


def _score(criteria: Criteria, criterion: Criterion) -> Decimal:
    item = criteria.get(criterion.value)
    score = item.get("score") if isinstance(item, Mapping) else None
    # bool은 int에 속하므로 true를 1점으로 처리하지 않도록 형식을 정확히 비교한다.
    if type(score) is not int or not 0 <= score <= 100:
        raise MissingCriterionError(f"{criterion} 점수는 0~100의 정수여야 한다")
    return Decimal(score)


def _mean(values: Sequence[Decimal]) -> int:
    return round_half_up_int(sum(values, Decimal(0)) / len(values))


def answer_score(criteria: Criteria) -> int:
    """한 답변의 네 평가 항목 점수를 평균해 정수로 반올림한다."""
    return _mean([_score(criteria, criterion) for criterion in Criterion])


def session_scores(answers: Sequence[Criteria]) -> dict[Criterion, int]:
    """답변이 있는 질문들의 항목별 점수를 평균해 정수로 반올림한다."""
    if not answers:
        raise ValueError("답변이 없어 항목별 점수를 계산할 수 없다")
    return {
        criterion: _mean([_score(criteria, criterion) for criteria in answers])
        for criterion in Criterion
    }
