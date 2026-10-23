from app.common.results import FAILED_RESULT_TYPES, ResultType
from app.worker.failures import FAILED_RESULT_OF_JOB
from app.worker.messages import JobType


def test_score_answer_has_no_failed_result() -> None:
    """SCORE_ANSWER는 결과 생성이 다시 채점하므로(AI 명세 5장) 실패 결과 종류가 없다."""
    assert FAILED_RESULT_OF_JOB == {
        JobType.PLAN: ResultType.PLAN_FAILED,
        JobType.EVALUATE: ResultType.EVALUATION_FAILED,
        JobType.MERGE_RECORDING: ResultType.RECORDING_MERGE_FAILED,
    }


def test_failed_results_match_reason_check() -> None:
    """작업 실패 결과는 모두 전송기가 reason을 검사하는 종류여야 한다.

    빠지면 실패 결과가 reason 없이 전송돼 BE가 처리를 나누지 못한다.
    """
    assert set(FAILED_RESULT_OF_JOB.values()) == FAILED_RESULT_TYPES
