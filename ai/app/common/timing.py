"""소요 시간 로그의 공통 단위.

Infra가 로그에서 `ms=` 값을 추출해 소요 시간 패널을 만들므로, 모든 소요 시간을 밀리초 정수로 남긴다.
"""


def elapsed_ms(started: float, ended: float) -> int:
    """time.monotonic()으로 잰 두 시각(초)의 차이를 밀리초 정수로 반환한다."""
    return round((ended - started) * 1000)
