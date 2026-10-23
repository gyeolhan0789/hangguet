"""질문 생성 작업의 출력 오류."""


class PlanOutputError(ValueError):
    """GMS 출력이 정해진 구조가 아니다(AI 명세 5장 출력 구조 깨짐)."""


class PlanFailedError(Exception):
    """재시도해도 질문 생성 결과가 검증을 통과하지 못했다.

    작업은 plan.failed로 끝난다.
    """
