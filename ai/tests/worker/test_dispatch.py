import logging
from datetime import datetime, timedelta, timezone

import pytest

from app.common.session import InterviewMode
from app.worker.dispatch import Dispatcher, DispatchResult, DuplicateHandlerError
from app.worker.messages import EvaluateJob, Job, PlanJob, ScoreAnswerJob

# BE가 작업을 요청한 시각(AI 명세 1.3 requestedAt)
REQUESTED_AT = datetime(2026, 10, 22, 14, 3, 13, tzinfo=timezone(timedelta(hours=9)))
SCORE = ScoreAnswerJob(
    job_id="job-1",
    session_id=55,
    requested_at=REQUESTED_AT,
    answer_id=903,
    mode=InterviewMode.CHAT,
    seq=1,
    question="질문",
    criteria="기준",
    content="답변",
    tokens=None,
    speech=None,
)
EVALUATE = EvaluateJob(
    job_id="job-2",
    session_id=55,
    requested_at=REQUESTED_AT,
    mode=InterviewMode.CHAT,
    cover_letter="자소서",
    claims=(),
    answers=(),
)
PLAN = PlanJob(
    job_id="job-3",
    session_id=56,
    requested_at=REQUESTED_AT,
    company_name="회사",
    job_title="직무",
    cover_letter="자소서",
)


def test_registered_job_is_handled() -> None:
    received: list[ScoreAnswerJob] = []
    dispatcher = Dispatcher()
    dispatcher.register(ScoreAnswerJob, received.append)

    assert dispatcher.dispatch(SCORE) is DispatchResult.HANDLED
    assert received == [SCORE]


def test_job_goes_only_to_handler_of_its_type() -> None:
    plans: list[PlanJob] = []
    scores: list[ScoreAnswerJob] = []
    dispatcher = Dispatcher()
    dispatcher.register(PlanJob, plans.append)
    dispatcher.register(ScoreAnswerJob, scores.append)

    dispatcher.dispatch(PLAN)

    assert plans == [PLAN]
    assert scores == []


def test_unregistered_job_type_is_no_handler() -> None:
    """처리 함수가 없는 종류는 미처리로 반환해 큐 수신부가 작업을 폐기하지 않게 한다."""
    received: list[ScoreAnswerJob] = []
    dispatcher = Dispatcher()
    dispatcher.register(ScoreAnswerJob, received.append)

    assert dispatcher.dispatch(EVALUATE) is DispatchResult.NO_HANDLER
    assert received == []


def test_handler_exception_is_failed_and_logged(caplog: pytest.LogCaptureFixture) -> None:
    def broken(job: ScoreAnswerJob) -> None:
        raise RuntimeError("GMS 호출 실패")

    dispatcher = Dispatcher()
    dispatcher.register(ScoreAnswerJob, broken)

    with caplog.at_level(logging.ERROR, logger="app.worker.dispatch"):
        result = dispatcher.dispatch(SCORE)

    assert result is DispatchResult.FAILED
    [record] = caplog.records
    assert "job-1" in record.getMessage()
    assert record.exc_info is not None


def test_dispatch_continues_after_failure() -> None:
    received: list[Job] = []

    def broken(job: ScoreAnswerJob) -> None:
        raise RuntimeError("실패")

    dispatcher = Dispatcher()
    dispatcher.register(ScoreAnswerJob, broken)
    dispatcher.register(EvaluateJob, received.append)

    assert dispatcher.dispatch(SCORE) is DispatchResult.FAILED
    assert dispatcher.dispatch(EVALUATE) is DispatchResult.HANDLED
    assert received == [EVALUATE]


def test_duplicate_registration_raises() -> None:
    dispatcher = Dispatcher()
    dispatcher.register(EvaluateJob, lambda job: None)

    with pytest.raises(DuplicateHandlerError, match="EVALUATE"):
        dispatcher.register(EvaluateJob, lambda job: None)


def test_wait_and_processing_time_are_logged_per_job_type(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """BE 대기 상한은 요청 시각부터 계산하므로 큐 대기와 처리 시간을 함께 남긴다(AI 명세 1.3)."""
    ticks = iter([100.0, 141.0])
    dispatcher = Dispatcher(
        now=lambda: REQUESTED_AT + timedelta(seconds=2.1), timer=lambda: next(ticks)
    )
    dispatcher.register(PlanJob, lambda job: None)
    with caplog.at_level(logging.INFO, logger="app.worker.dispatch"):
        dispatcher.dispatch(PLAN)
    assert [record.getMessage() for record in caplog.records] == [
        "작업 시작 jobType=PLAN jobId=job-3 sessionId=56 waitMs=2100",
        "작업 끝 jobType=PLAN jobId=job-3 result=HANDLED ms=41000",
    ]


def test_failed_job_logs_failure_and_processing_time(caplog: pytest.LogCaptureFixture) -> None:
    ticks = iter([0.0, 0.5])
    dispatcher = Dispatcher(now=lambda: REQUESTED_AT, timer=lambda: next(ticks))

    def fail(job: ScoreAnswerJob) -> None:
        raise RuntimeError("결과 전송 실패")

    dispatcher.register(ScoreAnswerJob, fail)
    with caplog.at_level(logging.INFO, logger="app.worker.dispatch"):
        assert dispatcher.dispatch(SCORE) is DispatchResult.FAILED
    messages = [record.getMessage() for record in caplog.records]
    assert messages[1] == "작업 처리 실패 jobType=SCORE_ANSWER jobId=job-1 sessionId=55"
    assert messages[2] == "작업 끝 jobType=SCORE_ANSWER jobId=job-1 result=FAILED ms=500"


def test_unregistered_job_type_logs_no_processing_time(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="app.worker.dispatch"):
        Dispatcher().dispatch(PLAN)
    assert [record.getMessage() for record in caplog.records] == [
        "처리 함수 없음 jobType=PLAN jobId=job-3"
    ]
