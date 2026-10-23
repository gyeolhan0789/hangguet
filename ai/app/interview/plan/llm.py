"""질문 생성 작업의 출력 오류."""


class PlanOutputError(ValueError):
    """GMS 출력이 정해진 구조가 아니다(AI 명세 5장 출력 구조 깨짐)."""
