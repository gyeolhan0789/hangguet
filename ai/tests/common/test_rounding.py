from decimal import Decimal

import pytest

from app.common.rounding import round_half_up, round_half_up_float, round_half_up_int


@pytest.mark.parametrize(
    ("value", "expected"),
    [(70.5, 71), (71.5, 72), (70.49, 70), (89.5, 90), (Decimal("69.5"), 70)],
)
def test_rounds_half_up_to_integer(value: float | Decimal, expected: int) -> None:
    """.5는 짝수 쪽이 아니라 항상 올림 처리한다(내장 round(70.5)는 70이다)."""
    assert round_half_up_int(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [(2.675, 2.68), (12.345, 12.35), (1.005, 1.01), (6.2, 6.2), (3.0, 3.0)],
)
def test_rounds_to_two_decimal_places(value: float, expected: float) -> None:
    """이진 표현 오차로 내장 round(2.675, 2)가 2.67이 되는 경우도 표시된 값 기준으로 올림한다."""
    assert round_half_up_float(value, 2) == expected


def test_returns_decimal_with_requested_places() -> None:
    assert round_half_up(12.5, 1) == Decimal("12.5")
    assert str(round_half_up(12, 2)) == "12.00"
