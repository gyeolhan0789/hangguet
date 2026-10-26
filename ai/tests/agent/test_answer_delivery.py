"""화상 답변 전달 시험."""

import asyncio
from datetime import datetime
from unittest.mock import Mock, patch

import pytest

from app.agent.answer_capture import CapturedAnswer
from app.agent.answer_delivery import AnswerDelivery
from app.agent.interview import FinishedAnswer
from app.common.answer import SpeechToken, VoiceMetrics
from app.common.results import KST, ResultPublisher, ResultPublishError, ResultType
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
    with patch("app.agent.answer_delivery.voice_metrics", return_value=metrics) as measure:
        saved = asyncio.run(AnswerDelivery(55, results, 16_000).deliver(finished()))
    assert saved
    samples, rate, tokens = measure.call_args.args
    assert (samples.size, rate, tokens) == (160, 16_000, TOKENS)
    results.publish.assert_called_once_with(
        ResultType.ANSWER_COMPLETED,
        55,
        {
            "seq": 3,
            "answerStartedAt": "2026-10-26T14:02:18.250+09:00",
            "content": "조회 쿼리를 확인했습니다",
            "tokens": [{"text": "조회", "startMs": 0, "endMs": 280}],
            "speech": {"trailingOffRatio": 12.5, "pitchRangeSt": 6.2},
            "endReason": "MANUAL_SUBMIT",
        },
    )


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
