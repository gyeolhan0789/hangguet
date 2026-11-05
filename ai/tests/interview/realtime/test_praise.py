"""오리 면접관 칭찬 선택 시험(AI 명세 6.2 호응의 칭찬 표)."""

import pytest

from app.interview.realtime.praise import PRAISE_TEXTS, Praise, choose_praise
from app.interview.realtime.reaction import Attitude, Judgment, Reaction

NEUTRAL = Attitude(0.5, 0.5)


def reaction(value: str) -> Reaction:
    kind = "gesture" if value in {"nod", "tilt"} else "expression"
    return Reaction(kind, value, 0.4)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("judgment", "expected"),
    [
        (None, Praise.NO_JUDGMENT),
        (Judgment(reaction("frown"), Attitude(1.0, 1.0)), Praise.EFFORT),
        (Judgment(reaction("smirk"), Attitude(1.0, 1.0)), Praise.EFFORT),
        (Judgment(reaction("tilt"), Attitude(1.0, 1.0)), Praise.EFFORT),
        (Judgment(reaction("smile"), Attitude(0.25, 0.25)), Praise.EFFORT),
        (Judgment(reaction("smile"), Attitude(0.5, 0.75)), Praise.TRUST),
        (Judgment(reaction("smile"), Attitude(0.75, 0.5)), Praise.INTEREST),
        (Judgment(reaction("smile"), NEUTRAL), Praise.SMILE),
        (Judgment(reaction("nod"), NEUTRAL), Praise.NOD),
        (Judgment(None, NEUTRAL), Praise.DEFAULT),
        (Judgment(None, Attitude(0.25, 0.5)), Praise.DEFAULT),
        (Judgment(None, Attitude(0.5, 0.25)), Praise.DEFAULT),
        (Judgment(None, Attitude(0.74, 0.74)), Praise.DEFAULT),
    ],
)
def test_praise_follows_table_order(judgment: Judgment | None, expected: Praise) -> None:
    assert choose_praise(judgment) is expected


def test_trust_is_checked_before_interest() -> None:
    assert choose_praise(Judgment(None, Attitude(0.9, 0.9))) is Praise.TRUST


def test_every_praise_has_a_sentence() -> None:
    assert set(PRAISE_TEXTS) == set(Praise)
