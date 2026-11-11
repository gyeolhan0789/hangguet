from typing import Any

import pytest

from app.interview.result.scores import MissingCriterionError, answer_score, session_scores
from app.interview.scoring.judge import Criterion


def criteria(job_fit: int, cover_letter: int, logic: int, delivery: int) -> dict[str, Any]:
    values = zip(Criterion, (job_fit, cover_letter, logic, delivery), strict=True)
    return {criterion.value: {"score": score} for criterion, score in values}


@pytest.mark.parametrize(
    ("values", "expected"),
    [
        ((86, 71, 88, 69), 79),
        ((70, 70, 70, 72), 71),
        ((70, 70, 70, 71), 70),
        ((0, 0, 0, 0), 0),
        ((100, 100, 100, 100), 100),
    ],
)
def test_answer_score_averages_all_four_and_rounds_half_up(
    values: tuple[int, int, int, int], expected: int
) -> None:
    assert answer_score(criteria(*values)) == expected


def test_session_scores_average_each_criterion_over_answered_questions() -> None:
    assert session_scores([criteria(90, 50, 70, 71), criteria(80, 70, 70, 70)]) == {
        Criterion.JOB_FIT: 85,
        Criterion.COVER_LETTER: 60,
        Criterion.LOGIC: 70,
        Criterion.DELIVERY: 71,
    }


def test_single_answer_keeps_each_criterion_score() -> None:
    assert session_scores([criteria(86, 71, 88, 69)]) == {
        Criterion.JOB_FIT: 86,
        Criterion.COVER_LETTER: 71,
        Criterion.LOGIC: 88,
        Criterion.DELIVERY: 69,
    }


def test_session_uses_actual_answer_count_instead_of_five_questions() -> None:
    assert session_scores([criteria(90, 60, 70, 50)] * 3) == {
        Criterion.JOB_FIT: 90,
        Criterion.COVER_LETTER: 60,
        Criterion.LOGIC: 70,
        Criterion.DELIVERY: 50,
    }


def test_session_requires_at_least_one_answer() -> None:
    with pytest.raises(ValueError, match="답변이 없어"):
        session_scores([])


@pytest.mark.parametrize("criterion", list(Criterion))
def test_missing_criterion_rejects_both_averages(criterion: Criterion) -> None:
    item = criteria(70, 70, 70, 70)
    del item[criterion]
    with pytest.raises(MissingCriterionError, match=criterion):
        answer_score(item)
    answers = [criteria(70, 70, 70, 70), item]
    with pytest.raises(MissingCriterionError, match=criterion):
        session_scores(answers)


@pytest.mark.parametrize("broken", [None, "70", True, 70.0, -1, 101])
def test_invalid_score_rejects_both_averages(broken: Any) -> None:
    item = criteria(70, 70, 70, 70)
    item["LOGIC"]["score"] = broken
    with pytest.raises(MissingCriterionError, match="LOGIC"):
        answer_score(item)
    with pytest.raises(MissingCriterionError, match="LOGIC"):
        session_scores([item])


def test_non_object_criterion_is_rejected() -> None:
    item = criteria(70, 70, 70, 70)
    item["LOGIC"] = 70
    with pytest.raises(MissingCriterionError, match="LOGIC"):
        answer_score(item)


def test_reason_level_and_method_do_not_change_score_or_input() -> None:
    item = criteria(70, 70, 70, 70)
    item["LOGIC"].update(level=3, reason="검증 근거", scoreMethod="FIXED")
    assert answer_score(item) == 70
    assert item["LOGIC"] == {"score": 70, "level": 3, "reason": "검증 근거", "scoreMethod": "FIXED"}
