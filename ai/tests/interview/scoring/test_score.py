import pytest

from app.interview.scoring.score import (
    LevelOutOfRangeError,
    expected_score,
    fixed_score,
)


@pytest.mark.parametrize(("level", "score"), [(1, 50), (2, 70), (3, 90)])
def test_fixed_score_uses_level_score(level: int, score: int) -> None:
    assert fixed_score(level) == score


@pytest.mark.parametrize("level", [0, 4, -1, True])
def test_fixed_score_rejects_invalid_level(level: int) -> None:
    with pytest.raises(LevelOutOfRangeError):
        fixed_score(level)


@pytest.mark.parametrize(
    ("probs", "score"),
    [
        ({1: 1 / 3, 2: 1 / 3, 3: 1 / 3}, 70),
        ({3: 1.0}, 90),
        ({1: 0.4, 2: 0.175, 3: 0.425}, 71),
        ({1: 0.1, 3: 0.3}, 80),
        ({2: 0.2, 3: 0.2}, 80),
    ],
)
def test_expected_score_normalizes_and_rounds(probs: dict[int, float], score: int) -> None:
    assert expected_score(probs) == score


@pytest.mark.parametrize("level", [0, 4, -1, True])
def test_expected_score_rejects_invalid_level(level: int) -> None:
    with pytest.raises(LevelOutOfRangeError):
        expected_score({level: 1.0})


@pytest.mark.parametrize("probs", [{}, {1: 0.0, 2: 0.0}])
def test_expected_score_requires_positive_total(probs: dict[int, float]) -> None:
    with pytest.raises(ValueError, match="합은 양수"):
        expected_score(probs)
