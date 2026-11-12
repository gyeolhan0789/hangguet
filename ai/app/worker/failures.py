"""작업 종류별 실패 결과 종류(AI 명세 1.4).

결과 메시지 전송(app.common.results)은 면접 에이전트도 사용하므로,
작업 메시지 형식(JobType)에 의존하는 대응표만 분석 작업자에 둔다.
"""

from app.common.results import ResultType
from app.worker.messages import JobType

# SCORE_ANSWER는 실패 결과 없이 결과 생성이 다시 채점한다(AI 명세 5장)
FAILED_RESULT_OF_JOB: dict[JobType, ResultType] = {
    JobType.PLAN: ResultType.PLAN_FAILED,
    JobType.EXTRACT_CLAIMS: ResultType.CLAIMS_EXTRACT_FAILED,
    JobType.EVALUATE: ResultType.EVALUATION_FAILED,
    JobType.MERGE_RECORDING: ResultType.RECORDING_MERGE_FAILED,
}
