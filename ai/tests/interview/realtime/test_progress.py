"""질문 시작·답변 완료 결과 메시지.

결과 큐 전송기 시험과 같은 가짜 Redis로 결과 큐에 추가된 JSON을 확인한다.
"""

import json
from datetime import UTC, datetime, timedelta, timezone
from typing import Any, cast

import pytest
from redis import ConnectionError as RedisConnectionError
from redis import Redis

from app.common.answer import SpeechToken, VoiceMetrics
from app.common.results import KST, RESULT_QUEUE_KEY, ResultPublisher, ResultPublishError
from app.interview.realtime.progress import (
    MAX_CONTENT_LENGTH,
    EndReason,
    ProgressMessageError,
    answer_completed,
    question_started,
)
from app.interview.realtime.transcript import MAX_ANSWER_TOKENS, Transcript
from tests.common.test_results import FakeRedis
from tests.interview.realtime.replay import FIRST_SENTENCE, SECOND_SENTENCE, load_responses

NOW = datetime(2026, 10, 22, 14, 3, 12, tzinfo=KST)
# 답변을 듣기 시작한 시각.
# tokens 시각의 0ms다(AI 명세 6.2)
STARTED = datetime(2026, 10, 22, 14, 2, 18, 250000, tzinfo=KST)
# AI 명세 6.2 answer.completed 예시의 speech.impressions
IMPRESSIONS = {
    "promptVersion": "impression-v1",
    "modelVersion": "jev-1.14.0",
    "items": [
        {
            "atMs": 1500,
            "face": 0.98,
            "stability": 62.5,
            "confidence": 70.1,
            "expression": 55.0,
            "emotion": 48.3,
            "likeability": 66.0,
            "trust": 71.2,
        }
    ],
}


def publisher(redis: FakeRedis) -> ResultPublisher:
    return ResultPublisher(cast(Redis, redis), sleep=lambda _: None, clock=lambda: NOW)


def sent(redis: FakeRedis) -> list[dict[str, Any]]:
    return [json.loads(raw) for raw in redis.lists.get(RESULT_QUEUE_KEY, [])]


def test_question_started_has_spec_fields_and_millisecond_started_at() -> None:
    redis = FakeRedis()

    question_started(55, 3, datetime(2026, 10, 22, 14, 2, 10, tzinfo=KST), "질문", "기준").publish(
        publisher(redis)
    )

    # 필드는 AI 명세 6.2 question.started(seq, startedAt, content, criteria, 버전)와 같다.
    # startedAt은 다시보기 기준이므로 같은 메시지의 occurredAt(초 단위)과 달리 밀리초까지 기록한다.
    # 미리 만든 질문은 생성 버전이 없으므로 promptVersion·modelVersion이 null이다
    assert sent(redis) == [
        {
            "type": "question.started",
            "sessionId": 55,
            "seq": 3,
            "startedAt": "2026-10-22T14:02:10.000+09:00",
            "content": "질문",
            "criteria": "기준",
            "promptVersion": None,
            "modelVersion": None,
            "occurredAt": "2026-10-22T14:03:12+09:00",
        }
    ]


def test_followup_question_started_carries_generation_versions() -> None:
    message = question_started(
        55,
        2,
        NOW,
        "꼬리 질문",
        "꼬리 기준",
        prompt_version="followup-v1",
        model_version="gpt-5.6-terra-2026",
    )

    assert {key: message.fields[key] for key in ("content", "criteria")} == {
        "content": "꼬리 질문",
        "criteria": "꼬리 기준",
    }
    assert (message.fields["promptVersion"], message.fields["modelVersion"]) == (
        "followup-v1",
        "gpt-5.6-terra-2026",
    )


def test_started_at_is_converted_to_korea_time_with_milliseconds() -> None:
    utc = datetime(2026, 10, 22, 5, 2, 10, 123456, tzinfo=UTC)

    message = question_started(55, 1, utc, "질문", "기준")

    assert message.fields["startedAt"] == "2026-10-22T14:02:10.123+09:00"


def test_started_at_without_timezone_is_rejected() -> None:
    with pytest.raises(ProgressMessageError, match="시간대"):
        question_started(55, 1, datetime(2026, 10, 22, 14, 2, 10), "질문", "기준")


def test_answer_completed_matches_spec_example_without_job_id() -> None:
    redis = FakeRedis()

    answer_completed(
        55,
        3,
        STARTED,
        "조회 쿼리 실행 계획을 보고…",
        (SpeechToken("조회", 0, 280),),
        VoiceMetrics(trailing_off_ratio=12.5, pitch_range_st=6.2),
        EndReason.AUTO_SUBMIT,
        trailing_off_at_ms=(9120,),
        impressions=IMPRESSIONS,
    ).publish(publisher(redis))

    # AI 명세 6.2 answer.completed 예시와 같다.
    # 멱등 키와 jobId는 담지 않는다
    assert sent(redis) == [
        {
            "type": "answer.completed",
            "sessionId": 55,
            "seq": 3,
            "answerStartedAt": "2026-10-22T14:02:18.250+09:00",
            "content": "조회 쿼리 실행 계획을 보고…",
            "tokens": [{"text": "조회", "startMs": 0, "endMs": 280}],
            "speech": {
                "trailingOffRatio": 12.5,
                "pitchRangeSt": 6.2,
                "trailingOffAtMs": [9120],
                "impressions": IMPRESSIONS,
            },
            "endReason": "AUTO_SUBMIT",
            "occurredAt": "2026-10-22T14:03:12+09:00",
        }
    ]


def test_real_soniox_answer_becomes_answer_completed() -> None:
    transcript = Transcript()
    transcript.begin_connection(0)
    for response in load_responses():
        transcript.apply(response.tokens)

    message = answer_completed(
        55,
        1,
        STARTED,
        transcript.content(),
        transcript.answer_tokens(),
        None,
        EndReason.MANUAL_SUBMIT,
    )

    assert message.fields["content"] == f"{FIRST_SENTENCE} {SECOND_SENTENCE}"
    assert len(message.fields["tokens"]) == 48
    assert message.fields["endReason"] == "MANUAL_SUBMIT"


def test_answer_with_only_non_breaking_space_is_created_like_be() -> None:
    # BE가 answer.completed 답변 글을 String.isBlank로 검사하고(AiResultService),
    # 이 기준은 NBSP를 공백으로 보지 않으므로 메시지를 생성한다
    message = answer_completed(55, 1, STARTED, "\u00a0", None, None, EndReason.AUTO_SUBMIT)

    assert message.fields["content"] == "\u00a0"


def test_missing_tokens_are_sent_as_null() -> None:
    message = answer_completed(55, 1, STARTED, "답변입니다.", None, None, EndReason.MANUAL_SUBMIT)

    assert message.fields["tokens"] is None


@pytest.mark.parametrize("content", ["", "   ", "\t\n"])
def test_empty_answer_is_not_created(content: str) -> None:
    with pytest.raises(ProgressMessageError, match="비었다"):
        answer_completed(55, 1, STARTED, content, None, None, EndReason.AUTO_SUBMIT)


def test_content_length_boundary_uses_java_length() -> None:
    assert MAX_CONTENT_LENGTH == 10_000
    answer_completed(55, 1, STARTED, "가" * MAX_CONTENT_LENGTH, None, None, EndReason.AUTO_SUBMIT)
    with pytest.raises(ProgressMessageError, match="10,000자"):
        answer_completed(
            55, 1, STARTED, "가" * (MAX_CONTENT_LENGTH + 1), None, None, EndReason.AUTO_SUBMIT
        )
    # 그림 문자는 Java String.length로 2이므로 9,999자 + 그림 문자 1개는 BE 기준 10,001자다
    with pytest.raises(ProgressMessageError, match="10,000자"):
        answer_completed(
            55,
            1,
            STARTED,
            "가" * (MAX_CONTENT_LENGTH - 1) + "\U0001f600",
            None,
            None,
            EndReason.AUTO_SUBMIT,
        )


def test_token_count_boundary() -> None:
    tokens = tuple(SpeechToken("가", i, i + 1) for i in range(MAX_ANSWER_TOKENS))

    message = answer_completed(55, 1, STARTED, "가", tokens, None, EndReason.AUTO_SUBMIT)

    assert len(message.fields["tokens"]) == MAX_ANSWER_TOKENS
    with pytest.raises(ProgressMessageError, match="10,000개"):
        answer_completed(
            55, 1, STARTED, "가", (*tokens, SpeechToken("가", 0, 1)), None, EndReason.AUTO_SUBMIT
        )


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(SpeechToken("가", 300, 299), id="endMs below startMs"),
        pytest.param(SpeechToken("가", -1, 10), id="negative startMs"),
    ],
)
def test_invalid_token_is_rejected(token: SpeechToken) -> None:
    with pytest.raises(ProgressMessageError, match="tokens"):
        answer_completed(55, 1, STARTED, "가", (token,), None, EndReason.AUTO_SUBMIT)


def test_empty_text_token_is_sent_like_be() -> None:
    # AI 명세 6.2와 BE(AiResultService)는 토큰 글자를 검사하지 않으므로 빈 글자 토큰도 전송한다
    message = answer_completed(
        55, 1, STARTED, "가", (SpeechToken("", 0, 10),), None, EndReason.AUTO_SUBMIT
    )

    assert message.fields["tokens"] == [{"text": "", "startMs": 0, "endMs": 10}]


def test_equal_start_and_end_token_is_valid() -> None:
    message = answer_completed(
        55, 1, STARTED, "가", (SpeechToken(".", 10, 10),), None, EndReason.AUTO_SUBMIT
    )

    assert message.fields["tokens"] == [{"text": ".", "startMs": 10, "endMs": 10}]


@pytest.mark.parametrize(("session_id", "seq"), [(0, 1), (55, 0), (55, 6)])
def test_target_out_of_range_is_rejected(session_id: int, seq: int) -> None:
    with pytest.raises(ProgressMessageError):
        question_started(session_id, seq, NOW, "질문", "기준")
    with pytest.raises(ProgressMessageError):
        answer_completed(session_id, seq, STARTED, "답변", None, None, EndReason.AUTO_SUBMIT)


def test_seq_boundaries_are_valid() -> None:
    for seq in (1, 5):
        assert question_started(55, seq, NOW, "질문", "기준").fields["seq"] == seq


def test_publish_retries_then_raises_for_submit_failed() -> None:
    # 재시도까지 실패하면 오류를 전파해 에이전트가 화면에 submitFailed를 전송할 수 있게 한다
    redis = FakeRedis([RedisConnectionError("연결 실패")] * 4)
    message = answer_completed(55, 1, STARTED, "답변", None, None, EndReason.AUTO_SUBMIT)

    with pytest.raises(ResultPublishError):
        message.publish(publisher(redis))
    assert sent(redis) == []

    recovered = FakeRedis([RedisConnectionError("연결 실패")])
    message.publish(publisher(recovered))
    assert len(sent(recovered)) == 1


def test_other_offset_is_kept_as_same_instant() -> None:
    plus_one = timezone(timedelta(hours=1))

    message = question_started(
        55, 1, datetime(2026, 10, 22, 6, 2, 10, tzinfo=plus_one), "질문", "기준"
    )

    assert message.fields["startedAt"] == "2026-10-22T14:02:10.000+09:00"


def test_missing_voice_metrics_are_sent_as_nulls() -> None:
    """에이전트가 음성 지표를 구하지 못하면 두 값을 null로 전송한다(AI 명세 6.2 speech)."""
    message = answer_completed(55, 1, STARTED, "답변입니다.", None, None, EndReason.AUTO_SUBMIT)

    assert message.fields["speech"] == {
        "trailingOffRatio": None,
        "pitchRangeSt": None,
        "trailingOffAtMs": None,
        "impressions": None,
    }


def test_trailing_off_times_are_sent_in_order() -> None:
    message = answer_completed(
        55,
        1,
        STARTED,
        "답변입니다.",
        None,
        None,
        EndReason.AUTO_SUBMIT,
        trailing_off_at_ms=(3000, 1000),
    )

    assert message.fields["speech"]["trailingOffAtMs"] == [1000, 3000]


def test_negative_trailing_off_time_is_rejected() -> None:
    with pytest.raises(ProgressMessageError, match="trailingOffAtMs"):
        answer_completed(
            55,
            1,
            STARTED,
            "답변입니다.",
            None,
            None,
            EndReason.AUTO_SUBMIT,
            trailing_off_at_ms=(-1,),
        )


def test_too_many_trailing_off_times_are_rejected() -> None:
    with pytest.raises(ProgressMessageError, match="trailingOffAtMs"):
        answer_completed(
            55,
            1,
            STARTED,
            "답변입니다.",
            None,
            None,
            EndReason.AUTO_SUBMIT,
            trailing_off_at_ms=tuple(range(MAX_ANSWER_TOKENS + 1)),
        )


def test_answer_started_at_without_timezone_is_rejected() -> None:
    with pytest.raises(ProgressMessageError, match="answerStartedAt"):
        answer_completed(
            55, 1, datetime(2026, 10, 22, 14, 2, 18), "답변", None, None, EndReason.AUTO_SUBMIT
        )
