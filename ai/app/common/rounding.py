"""점수 계산에 사용하는 반올림.

Python의 round는 .5를 짝수 쪽으로 반올림하고(round(70.5) == 70), 실수의 이진 표현 오차로
round(2.675, 2)도 2.67이 된다. 명세의 「반올림」은 사사오입이므로 채점·결과 점수는 이 모듈의
함수만 사용한다. 실수를 문자열로 변환해 Decimal로 계산해야 표시된 값 기준으로 반올림된다.
"""

from decimal import ROUND_HALF_UP, Decimal


def round_half_up(value: float | Decimal, digits: int = 0) -> Decimal:
    exponent = Decimal(1).scaleb(-digits)
    return Decimal(str(value)).quantize(exponent, rounding=ROUND_HALF_UP)


def round_half_up_int(value: float | Decimal) -> int:
    return int(round_half_up(value))


def round_half_up_float(value: float | Decimal, digits: int) -> float:
    """NUMERIC(5,2)처럼 소수 자리가 정해진 컬럼에 기록할 값을 계산한다."""
    return float(round_half_up(value, digits))
