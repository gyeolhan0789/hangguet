from collections.abc import Mapping, Sequence
from typing import Any

import pytest

from app.common.gms import GmsResult, GmsUnavailableError
from app.common.results import ResultType
from app.interview.result.feedback import MAX_HEADLINE_LENGTH
from app.interview.result.headline import (
    WriteHeadlineJobHandler,
    build_headline_messages,
    parse_headline,
    write_headline,
)
from app.interview.scoring.judge import StructureBrokenError
from app.worker.messages import WriteHeadlineJob, parse_job

# 기준: AI 명세 4.1 한 줄 총평 채우기(임시).
# summary를 30자 이내로 줄이고, 넘으면 1회 다시 만든 뒤 자른다.

SUMMARY = "지원자는 일부 경험을 구체적으로 제시했으나 협력 경험 설명이 부족했습니다."
JOB = WriteHeadlineJob(
    job_id="8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34",
    session_id=20,
    requested_at=None,  # type: ignore[arg-type]
    summary=SUMMARY,
)


def result(headline: object) -> GmsResult:
    return GmsResult({"headline": headline}, None, "gpt-test")


def test_summary_is_sent_as_material() -> None:
    messages = build_headline_messages(SUMMARY)
    assert messages[1] == {"role": "user", "content": SUMMARY}
    assert "30자 이내" in messages[0]["content"]


def test_long_headline_is_retried_then_cut() -> None:
    replies = iter([result("가" * 31), result("나" * 40)])

    def chat(messages: Sequence[Mapping[str, str]]) -> GmsResult:
        return next(replies)

    assert write_headline(SUMMARY, chat) == "나" * MAX_HEADLINE_LENGTH


def test_blank_headline_is_broken() -> None:
    with pytest.raises(StructureBrokenError):
        parse_headline(result(" "))


class Results:
    def __init__(self) -> None:
        self.published: list[tuple[Any, ResultType, dict[str, Any]]] = []

    def publish_job_result(self, job: Any, result_type: ResultType, fields: Any) -> None:
        self.published.append((job, result_type, dict(fields)))


def test_handler_publishes_headline_or_nothing_on_failure() -> None:
    results = Results()
    WriteHeadlineJobHandler(results, lambda m: result("협력 경험을 더 구체적으로"))(JOB)  # type: ignore[arg-type]
    assert results.published == [
        (JOB, ResultType.HEADLINE_WRITTEN, {"headline": "협력 경험을 더 구체적으로"})
    ]

    def down(messages: Sequence[Mapping[str, str]]) -> GmsResult:
        raise GmsUnavailableError("503")

    failed = Results()
    WriteHeadlineJobHandler(failed, down)(JOB)  # type: ignore[arg-type]
    assert failed.published == []


def test_job_message_is_parsed() -> None:
    job = parse_job(
        '{"jobType": "WRITE_HEADLINE", "jobId": "8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34",'
        ' "sessionId": 20, "requestedAt": "2026-10-27T15:00:00+09:00", "summary": "총평"}'
    )
    assert isinstance(job, WriteHeadlineJob) and job.summary == "총평"
