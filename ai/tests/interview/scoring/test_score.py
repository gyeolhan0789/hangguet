import pytest

from app.interview.scoring.score import LevelOutOfRangeError, fixed_score


@pytest.mark.parametrize(("level", "score"), [(1, 50), (2, 70), (3, 90)])
def test_fixed_score_uses_level_score(level: int, score: int) -> None:
    assert fixed_score(level) == score


@pytest.mark.parametrize("level", [0, 4, -1, True])
def test_fixed_score_rejects_invalid_level(level: int) -> None:
    with pytest.raises(LevelOutOfRangeError):
        fixed_score(level)
