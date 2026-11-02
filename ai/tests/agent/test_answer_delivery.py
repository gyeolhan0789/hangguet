"""화상 답변 전달 시험."""

import asyncio
from dataclasses import replace
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

import pytest

from app.agent.answer_capture import CapturedAnswer
from app.agent.answer_delivery import AnswerDelivery
from app.agent.interview import FinishedAnswer
from app.common.answer import SpeechToken, VoiceMetrics
from app.common.results import KST, ResultPublisher, ResultPublishError, ResultType
from app.interview.realtime.impression import (
    IMPRESSION_CRITERIA,
    IMPRESSION_PROMPT_VERSION,
    Impression,
    TimedImpression,
)
from app.interview.realtime.progress import EndReason

STARTED_AT = datetime(2026, 10, 26, 14, 2, 18, 250_000, tzinfo=KST)
TOKENS = (SpeechToken("조회", 0, 280),)
PCM = b"\x01\x00" * 160


def finished(content: str = "조회 쿼리를 확인했습니다") -> FinishedAnswer:
    return FinishedAnswer(
        3, CapturedAnswer(STARTED_AT, content, TOKENS, PCM), EndReason.MANUAL_SUBMIT
    )


def test_delivers_answer_completed_with_voice_metrics() -> None:
    results = Mock(spec=ResultPublisher)
    metrics = VoiceMetrics(trailing_off_ratio=12.5, pitch_range_st=6.2)
    with (
        patch("app.agent.answer_delivery.voice_metrics", return_value=metrics) as measure,
        patch("app.agent.answer_delivery.trailing_off_at_ms", return_value=(280,)) as trailing,
    ):
        saved = asyncio.run(AnswerDelivery(55, results, 16_000).deliver(finished()))
    assert saved
    samples, rate, tokens = measure.call_args.args
    assert (samples.size, rate, tokens) == (160, 16_000, TOKENS)
    assert trailing.call_args.args[1:] == (16_000, TOKENS)
    results.publish.assert_called_once_with(
        ResultType.ANSWER_COMPLETED,
        55,
        {
            "seq": 3,
            "answerStartedAt": "2026-10-26T14:02:18.250+09:00",
            "content": "조회 쿼리를 확인했습니다",
            "tokens": [{"text": "조회", "startMs": 0, "endMs": 280}],
            "speech": {
                "trailingOffRatio": 12.5,
                "pitchRangeSt": 6.2,
                "trailingOffAtMs": [280],
                "impressions": None,
            },
            "endReason": "MANUAL_SUBMIT",
        },
    )


def impression(face: float = 0.9) -> Impression:
    return Impression(face=face, scores={key: 50.0 for key in IMPRESSION_CRITERIA})


def test_impressions_are_sent_relative_to_answer_start() -> None:
    """인상 판단의 atMs는 answerStartedAt 기준이다.

    답변 시작 전에 찍은 사진은 버린다(AI 명세 6.6).
    """
    results = Mock(spec=ResultPublisher)
    frames = (
        TimedImpression(STARTED_AT + timedelta(milliseconds=1500), impression(0.98)),
        TimedImpression(STARTED_AT - timedelta(milliseconds=200), impression()),
    )
    answer = replace(finished(), answer=replace(finished().answer, impressions=frames))

    asyncio.run(AnswerDelivery(55, results, 16_000, impression_model="jev-1.14.0").deliver(answer))

    speech = results.publish.call_args.args[2]["speech"]
    assert speech["impressions"] == {
        "promptVersion": IMPRESSION_PROMPT_VERSION,
        "modelVersion": "jev-1.14.0",
        "items": [{"atMs": 1500, "face": 0.98, **{key: 50.0 for key in IMPRESSION_CRITERIA}}],
    }


def test_impressions_are_null_when_not_judged() -> None:
    """Jev 키가 없어 판단하지 않았으면 impressions는 null이다."""
    results = Mock(spec=ResultPublisher)
    frames = (TimedImpression(STARTED_AT, impression()),)
    answer = replace(finished(), answer=replace(finished().answer, impressions=frames))

    asyncio.run(AnswerDelivery(55, results, 16_000).deliver(answer))

    assert results.publish.call_args.args[2]["speech"]["impressions"] is None


def test_publish_failure_is_raised_for_resubmit() -> None:
    results = Mock(spec=ResultPublisher)
    results.publish.side_effect = ResultPublishError("결과 메시지 전송 4회 실패")
    with pytest.raises(ResultPublishError):
        asyncio.run(AnswerDelivery(55, results, 16_000).deliver(finished()))


def test_answer_that_cannot_be_saved_is_not_delivered() -> None:
    results = Mock(spec=ResultPublisher)
    saved = asyncio.run(AnswerDelivery(55, results, 16_000).deliver(finished("가" * 10_001)))
    assert not saved
    results.publish.assert_not_called()
