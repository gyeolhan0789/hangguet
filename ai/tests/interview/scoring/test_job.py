import json
import logging
from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Any, cast

import pytest
from redis import ConnectionError as RedisConnectionError
from redis import Redis

from app.common.answer import SpeechToken, SttGap, VoiceMetrics
from app.common.gms import (
    GmsBadOutputError,
    GmsClient,
    GmsResult,
    GmsUnavailableError,
    HttpResponse,
)
from app.common.results import RESULT_QUEUE_KEY, ResultPublisher, ResultPublishError
from app.interview.scoring.job import (
    ScoreAnswerJobHandler,
    answer_speech,
    build_evaluation,
    gms_score_chat,
    register_score_answer_handler,
    score_answer_input,
)
from app.interview.scoring.judge import StructureBrokenError
from app.worker.dispatch import Dispatcher
from app.worker.messages import ScoreAnswerJob, parse_job
from app.worker.queue import PROCESSING_KEY, QUEUE_KEY, ReceiveResult, RedisJobQueue
from tests.common.test_results import FakeRedis
from tests.interview.plan.test_job_flow import ResultQueueDownRedis
from tests.interview.scoring.test_judge import GOOD
from tests.worker.test_queue import FakeListRedis

RAW: dict[str, Any] = {
    "jobType": "SCORE_ANSWER",
    "jobId": "8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34",
    "sessionId": 55,
    "requestedAt": "2026-10-22T14:03:13+09:00",
    "answerId": 903,
    "mode": "VIDEO",
    "seq": 1,
    "question": "응답 시간을 개선한 과정은 무엇인가?",
    "criteria": "원인 분석과 수치 근거",
    "content": "캐시를 추가해 개선했습니다.",
    "tokens": [
        {"text": "음,", "startMs": 0, "endMs": 300},
        {"text": " 개선했습니다.", "startMs": 400, "endMs": 1400},
    ],
    "speech": {"trailingOffRatio": 12.5, "pitchRangeSt": 6.2},
}
JOB = cast(ScoreAnswerJob, parse_job(RAW))


class FakeChat:
    def __init__(self, *outcomes: GmsResult | Exception) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[Sequence[Mapping[str, str]]] = []

    def __call__(self, messages: Sequence[Mapping[str, str]]) -> GmsResult:
        self.calls.append(messages)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def good() -> GmsResult:
    return GmsResult(dict(GOOD), "served-model")


def make(chat: FakeChat, redis: FakeRedis | None = None) -> tuple[ScoreAnswerJobHandler, FakeRedis]:
    store = redis if redis is not None else FakeRedis()
    publisher = ResultPublisher(cast(Redis, store), sleep=lambda seconds: None)
    return ScoreAnswerJobHandler(publisher, chat), store


def pushed(redis: FakeRedis) -> list[dict[str, Any]]:
    return [json.loads(raw) for raw in redis.lists.get(RESULT_QUEUE_KEY, [])]


def test_video_result_contains_only_contract_fields() -> None:
    chat = FakeChat(good())
    handler, redis = make(chat)
    handler(JOB)
    [message] = pushed(redis)
    assert set(message) == {"type", "sessionId", "jobId", "occurredAt", "answerId", "evaluation"}
    assert (message["type"], message["sessionId"], message["jobId"], message["answerId"]) == (
        "answer.scored",
        55,
        JOB.job_id,
        903,
    )
    evaluation = message["evaluation"]
    assert set(evaluation) == {"criteria", "speech", "promptVersion", "modelVersion"}
    assert evaluation["promptVersion"] == "score-answer-v2"
    assert evaluation["modelVersion"] == "served-model"
    assert evaluation["criteria"]["LOGIC"] == {
        "level": 3,
        "score": 90,
        "scoreMethod": "FIXED",
        "reason": "판정 근거",
    }
    assert evaluation["speech"] == {
        "fillerCount": 1,
        "speakingMs": 1400,
        "longPauseCount": 0,
        "syllablesPerMin": 300,
        "trailingOffRatio": 12.5,
        "pitchRangeSt": 6.2,
    }
    assert "발화 시간" not in chat.calls[0][1]["content"]


def test_result_records_fixed_method_per_criterion() -> None:
    evaluation = build_evaluation(score_answer_input(JOB), FakeChat(good()))
    assert "scoreMethod" not in evaluation
    assert {name: item["scoreMethod"] for name, item in evaluation["criteria"].items()} == {
        "JOB_FIT": "FIXED",
        "COVER_LETTER": "FIXED",
        "LOGIC": "FIXED",
        "DELIVERY": "FIXED",
    }


def test_chat_result_has_null_speech_and_no_metric_prompt() -> None:
    job = cast(
        ScoreAnswerJob,
        parse_job(
            {key: value for key, value in RAW.items() if key not in {"tokens", "speech"}}
            | {"mode": "CHAT"}
        ),
    )
    chat = FakeChat(good())
    handler, redis = make(chat)
    handler(job)
    assert pushed(redis)[0]["evaluation"]["speech"] is None
    assert "말하기 지표" not in chat.calls[0][1]["content"]


@pytest.mark.parametrize("tokens", [None, ()])
def test_video_without_tokens_keeps_voice_metrics(tokens: tuple[SpeechToken, ...] | None) -> None:
    answer = score_answer_input(replace(JOB, tokens=tokens))
    assert answer_speech(answer) == {
        "fillerCount": None,
        "speakingMs": None,
        "longPauseCount": None,
        "syllablesPerMin": None,
        "trailingOffRatio": 12.5,
        "pitchRangeSt": 6.2,
    }


def test_missing_all_metrics_keeps_six_null_fields_and_text_only_prompt() -> None:
    chat = FakeChat(good())
    evaluation = build_evaluation(score_answer_input(replace(JOB, tokens=None, speech=None)), chat)
    assert evaluation["speech"] == dict.fromkeys(
        [
            "fillerCount",
            "speakingMs",
            "longPauseCount",
            "syllablesPerMin",
            "trailingOffRatio",
            "pitchRangeSt",
        ]
    )
    assert "말하기 지표" not in chat.calls[0][1]["content"]


def test_partial_voice_metrics_preserve_zero_values() -> None:
    speech = answer_speech(score_answer_input(replace(JOB, speech=VoiceMetrics(0, None))))
    assert speech is not None
    assert speech["trailingOffRatio"] == 0
    assert speech["pitchRangeSt"] is None


@pytest.mark.parametrize(
    "first", [GmsBadOutputError("invalid JSON"), GmsResult({}, "invalid-model")]
)
def test_structure_failure_retries_once_and_uses_successful_model(
    first: GmsResult | Exception,
) -> None:
    chat = FakeChat(first, good())
    handler, redis = make(chat)
    handler(JOB)
    assert len(chat.calls) == 2
    assert pushed(redis)[0]["evaluation"]["modelVersion"] == "served-model"


@pytest.mark.parametrize("failure", [GmsBadOutputError("invalid JSON"), GmsResult({}, "test")])
def test_repeated_structure_failure_sends_no_result(failure: GmsResult | Exception) -> None:
    chat = FakeChat(failure, failure, good())
    handler, redis = make(chat)
    handler(JOB)
    assert len(chat.calls) == 2
    assert pushed(redis) == []


@pytest.mark.parametrize("error", [GmsUnavailableError("unavailable"), RuntimeError("unexpected")])
def test_other_failure_is_not_structure_retry_and_sends_no_result(
    error: Exception, caplog: pytest.LogCaptureFixture
) -> None:
    chat = FakeChat(error, good())
    handler, redis = make(chat)
    with caplog.at_level(logging.ERROR, logger="app.interview.scoring.job"):
        handler(JOB)
    assert len(chat.calls) == 1
    assert pushed(redis) == []
    assert f"answerId={JOB.answer_id}" in caplog.text
    if isinstance(error, RuntimeError):
        assert caplog.records[-1].exc_info is not None


def test_build_evaluation_propagates_final_structure_failure() -> None:
    answer = score_answer_input(JOB)
    chat = FakeChat(GmsResult({}, "test"), GmsResult({}, "test"))
    with pytest.raises(StructureBrokenError):
        build_evaluation(answer, chat)


def test_result_queue_failure_propagates() -> None:
    handler, redis = make(FakeChat(good()), FakeRedis([RedisConnectionError("down")] * 4))
    with pytest.raises(ResultPublishError):
        handler(JOB)
    assert redis.calls == 4
    assert pushed(redis) == []


def test_gms_score_chat_requests_without_logprobs_with_real_client() -> None:
    """gpt-5.6-terra가 logprobs 요청을 400으로 거절하므로 채점 요청에도 포함하지 않는다."""
    payloads: list[dict[str, Any]] = []

    def transport(payload: dict[str, Any]) -> HttpResponse:
        payloads.append(payload)
        body = {"model": "served-model", "choices": [{"message": {"content": json.dumps(GOOD)}}]}
        return HttpResponse(200, {}, json.dumps(body).encode())

    client = GmsClient(model="gpt-5.6-terra", transport=transport)
    evaluation = build_evaluation(score_answer_input(JOB), gms_score_chat(lambda: client))
    assert evaluation["modelVersion"] == "served-model"
    assert set(payloads[0]) == {"model", "messages", "response_format"}


@pytest.mark.parametrize("fails", [False, True])
def test_queue_removes_completed_jobs_even_if_scoring_fails(fails: bool) -> None:
    redis = FakeListRedis()
    raw = json.dumps(RAW)
    redis.lpush(QUEUE_KEY, raw)
    client = cast(Redis, redis)
    results = ResultPublisher(client, sleep=lambda seconds: None)
    chat = FakeChat(GmsUnavailableError("unavailable") if fails else good())
    dispatcher = Dispatcher()
    register_score_answer_handler(dispatcher, ScoreAnswerJobHandler(results, chat))
    assert RedisJobQueue(client, dispatcher, results).receive_once() is ReceiveResult.HANDLED
    assert redis.items(PROCESSING_KEY) == []
    assert len(redis.items(RESULT_QUEUE_KEY)) == (0 if fails else 1)


def test_result_queue_failure_preserves_job_until_recovery() -> None:
    redis = ResultQueueDownRedis()
    raw = json.dumps(RAW)
    redis.lpush(QUEUE_KEY, raw)
    client = cast(Redis, redis)
    dispatcher = Dispatcher()
    handler = ScoreAnswerJobHandler(
        ResultPublisher(client, sleep=lambda seconds: None), FakeChat(good())
    )
    register_score_answer_handler(dispatcher, handler)
    queue = RedisJobQueue(client, dispatcher, ResultPublisher(client))
    assert queue.receive_once() is ReceiveResult.FAILED
    assert redis.items(PROCESSING_KEY) == [raw]
    assert queue.recover() == 1
    assert redis.items(QUEUE_KEY) == [raw]


def test_pause_inside_stt_gap_is_not_counted_and_gap_is_given_to_judge() -> None:
    """AI 명세 3장: 끊긴 구간과 겹치는 쉼은 긴 멈춤으로 집계하지 않고 발화 시간에서도 제외한다."""
    tokens = (SpeechToken("캐시를", 0, 500), SpeechToken(" 도입한", 9_500, 10_000))
    job = replace(JOB, tokens=tokens, stt_gaps=(SttGap(800, 9_000),))
    chat = FakeChat(good())
    handler, redis = make(chat)
    handler(job)
    [message] = pushed(redis)
    speech = message["evaluation"]["speech"]
    assert speech["longPauseCount"] == 0
    assert speech["speakingMs"] == 1_000
    assert "[음성 인식이 끊긴 구간(답변 시작 기준)]\n- 0.8~9.0초" in chat.calls[0][1]["content"]
