import json
import logging
from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Any, cast

import pytest
from redis import Redis

from app.common.gms import GmsBadOutputError, GmsResult, GmsUnavailableError
from app.common.results import RESULT_QUEUE_KEY, ResultPublisher, ResultPublishError
from app.common.session import Persona
from app.common.settings import load_settings
from app.interview.result.feedback import feedback_system, gms_feedback_chat
from app.interview.result.job import (
    ANALYSIS_TIMEOUT_SECONDS,
    EvaluateJobHandler,
    check_stored,
    evaluate_answer_input,
    register_evaluate_handler,
)
from app.interview.result.timeline import Metric
from app.interview.result.timeline_feedback import DEFAULT_TEXTS
from app.interview.scoring.job import answer_speech, gms_score_chat
from app.interview.scoring.judge import Criterion
from app.interview.speech import aggregate_speech_metrics
from app.interview.talent import criteria_names
from app.worker.dispatch import Dispatcher, DispatchResult
from app.worker.main import lazy_gms_client
from app.worker.messages import EvaluateJob, parse_job
from tests.common.test_results import FakeRedis
from tests.interview.plan.test_job import FailingRedis
from tests.interview.scoring.test_judge import GOOD

SPEECH_1 = {
    "fillerCount": 2,
    "speakingMs": 60_000,
    "longPauseCount": 1,
    "syllablesPerMin": 310,
    "trailingOffRatio": 10.0,
    "pitchRangeSt": 5.0,
}
SPEECH_2 = {
    "fillerCount": 1,
    "speakingMs": 30_000,
    "longPauseCount": 0,
    "syllablesPerMin": 250,
    "trailingOffRatio": 20.0,
    "pitchRangeSt": 8.0,
}
TOKENS = [
    {"text": "음,", "startMs": 0, "endMs": 300},
    {"text": " 개선했습니다.", "startMs": 400, "endMs": 1400},
]
STEPS = ["ORGANIZING_ANSWERS", "SCORING", "WRITING_FEEDBACK"]
COVER_LETTER = {"COVER_LETTER": {"reason": "자소서와 어긋남", "level": 1}}


def evaluation(score: int = 70, speech: Mapping[str, Any] | None = SPEECH_1) -> dict[str, Any]:
    """답변 채점(answer.scored)이 전송한 evaluation과 같은 형식(AI 명세 3장)."""
    return {
        "criteria": {
            c.value: {"level": 2, "score": score, "scoreMethod": "FIXED", "reason": f"{c} 판정"}
            for c in Criterion
        },
        "speech": dict(speech) if speech is not None else None,
        "promptVersion": "score-answer-v1",
        "modelVersion": "gpt-score",
    }


def answer(answer_id: int, seq: int, stored: Mapping[str, Any] | None) -> dict[str, Any]:
    return {
        "answerId": answer_id,
        "seq": seq,
        "question": f"질문 {seq}",
        "criteria": f"기준 {seq}",
        "content": f"답변 {seq}",
        "tokens": TOKENS,
        "speech": {"trailingOffRatio": 12.5, "pitchRangeSt": 6.2},
        "evaluation": stored,
    }


def job(
    *answers: dict[str, Any],
    mode: str = "VIDEO",
    items: list[dict[str, str]] | None = None,
) -> EvaluateJob:
    raw: dict[str, Any] = {
        "jobType": "EVALUATE",
        "jobId": "8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34",
        "sessionId": 55,
        "requestedAt": "2026-10-22T14:03:13+09:00",
        "mode": mode,
        "coverLetterItems": items
        or [{"question": "지원 동기", "answer": "저는 조회 응답 시간을 40% 줄였습니다."}],
        "claims": [{"id": "c1", "text": "응답 시간 40% 단축", "type": "NUMBER", "sentenceNo": 1}],
        "answers": list(answers)
        or [answer(903, 1, evaluation()), answer(904, 2, evaluation(speech=SPEECH_2))],
    }
    if mode == "CHAT":
        for item in raw["answers"]:
            item["tokens"] = item["speech"] = None
    return cast(EvaluateJob, parse_job(raw))


JOB = job()
REQUESTED = JOB.requested_at.timestamp()


def feedback_reply(job: EvaluateJob = JOB) -> dict[str, Any]:
    return {
        "answers": [
            {
                "seq": a.seq,
                "shownCriteria": [],
                "goodPoint": f"잘한 점 {a.seq}",
                # 드러난 기준이 없으면 개선할 점에 그 면접관의 기준 이름이 있어야 한다(AI 명세 4장)
                "improvePoint": f"고칠 점 {a.seq}: {min(criteria_names(job.persona))}",
            }
            for a in job.answers
        ],
        "criteria": {c.value: f"{c.value} 코멘트" for c in Criterion},
        "headline": "근거는 분명하나 결론이 늦어요",
        "summary": "근거가 분명한 면접이었습니다.",
    }


class FakeChat:
    def __init__(self, *outcomes: Mapping[str, Any] | Exception) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[Sequence[Mapping[str, str]]] = []

    def __call__(self, messages: Sequence[Mapping[str, str]]) -> GmsResult:
        self.calls.append(messages)
        item = self.outcomes.pop(0)
        if isinstance(item, Exception):
            raise item
        model = "gpt-feedback" if "summary" in item else "gpt-judge"
        return GmsResult(dict(item), None, model)


def make(
    score_chat: Any,
    feedback_chat: Any,
    redis: FakeRedis | None = None,
    *,
    now: float = REQUESTED + 1,
) -> tuple[EvaluateJobHandler, FakeRedis]:
    store = redis if redis is not None else FakeRedis()
    results = ResultPublisher(cast(Redis, store), sleep=lambda seconds: None)
    return EvaluateJobHandler(results, score_chat, feedback_chat, clock=lambda: now), store


def pushed(redis: FakeRedis) -> list[dict[str, Any]]:
    """BE가 BLMOVE ... RIGHT로 꺼내는 순서(오래된 것부터)로 반환한다."""
    return [json.loads(raw) for raw in reversed(redis.lists.get(RESULT_QUEUE_KEY, []))]


def run(
    target: EvaluateJob = JOB,
    score: FakeChat | None = None,
    written: FakeChat | None = None,
) -> tuple[list[dict[str, Any]], FakeChat, FakeChat]:
    score = score or FakeChat(*[COVER_LETTER] * len(target.answers))
    written = written or FakeChat(feedback_reply(target))
    handler, redis = make(score, written)
    handler(target)
    return pushed(redis), score, written


def test_publishes_each_step_then_completed_result() -> None:
    messages, _, _ = run()
    assert [m["type"] for m in messages] == ["evaluation.progress"] * 3 + ["evaluation.completed"]
    assert [m["analysisStep"] for m in messages[:3]] == STEPS
    completed = messages[-1]
    assert set(completed) == {
        "type",
        "sessionId",
        "jobId",
        "occurredAt",
        "answers",
        "sessionScores",
        "speechMetrics",
        "headline",
        "summary",
    }
    assert [set(a) for a in completed["answers"]] == [
        {"answerId", "score", "goodPoint", "improvePoint", "evaluation"}
    ] * 2
    assert [a["answerId"] for a in completed["answers"]] == [903, 904]
    assert completed["answers"][0]["goodPoint"] == "잘한 점 1"
    assert completed["summary"] == "근거가 분명한 면접이었습니다."


def test_confirmed_cover_letter_score_is_used_for_averages() -> None:
    """자소서 검증 판정을 확정한 뒤의 점수로 답변·항목 평균을 계산한다(AI 명세 4장)."""
    completed = run()[0][-1]
    confirmed = completed["answers"][0]["evaluation"]["criteria"]["COVER_LETTER"]
    assert (confirmed["level"], confirmed["score"], confirmed["reason"]) == (
        1,
        50,
        "자소서와 어긋남",
    )
    assert [a["score"] for a in completed["answers"]] == [65, 65]
    assert completed["sessionScores"] == [
        {
            "criterion": c.value,
            "score": 50 if c is Criterion.COVER_LETTER else 70,
            "comment": f"{c.value} 코멘트",
        }
        for c in Criterion
    ]


def test_scored_answer_is_not_scored_again() -> None:
    _, score, _ = run()
    # 답변마다 자소서 대조 한 번씩만 호출한다
    assert len(score.calls) == 2
    assert all("자기소개서" in call[1]["content"] for call in score.calls)


def test_cover_letter_judge_gets_every_item_in_order() -> None:
    """AI 명세 4장: 자소서 원문은 문항마다 질문 줄 다음 답변을 두고 빈 줄로 잇는다."""
    target = job(
        items=[
            {"question": "지원 동기", "answer": "저는 조회 응답 시간을 40% 줄였습니다."},
            {"question": "협업 경험", "answer": "팀원 4명과 장애 대응 절차를 정리했습니다."},
        ]
    )
    _, score, _ = run(target)

    prompt = score.calls[0][1]["content"]
    assert (
        "[자기소개서]\n지원 동기\n저는 조회 응답 시간을 40% 줄였습니다.\n\n"
        "협업 경험\n팀원 4명과 장애 대응 절차를 정리했습니다.\n"
    ) in prompt


def test_unscored_answer_is_scored_before_cover_letter() -> None:
    target = job(answer(903, 1, evaluation()), answer(904, 2, None))
    messages, score, _ = run(target, FakeChat(GOOD, COVER_LETTER, COVER_LETTER))
    assert len(score.calls) == 3
    assert "자기소개서" not in score.calls[0][1]["content"]
    rescored = messages[-1]["answers"][1]["evaluation"]
    assert rescored["criteria"]["LOGIC"]["score"] == 90
    assert rescored["promptVersion"] == "score-answer-v1"


# 기준: AI 명세 4장 WRITING_FEEDBACK(결과 생성은 작업의 면접관 기준으로 세부 피드백을 작성)
@pytest.mark.parametrize("persona", list(Persona))
def test_feedback_is_written_with_job_persona(persona: Persona) -> None:
    _, _, written = run(replace(JOB, persona=persona))
    assert written.calls[0][0]["content"] == feedback_system(persona)


def test_stored_speech_is_aggregated_as_judged() -> None:
    """이미 채점한 답변은 전달력 판정에 사용한 speech를 그대로 집계한다."""
    metrics = run()[0][-1]["speechMetrics"]
    assert metrics == aggregate_speech_metrics([SPEECH_1, SPEECH_2])
    # (310×60초 + 250×30초) ÷ 90초 = 290, (290 − 265) ÷ 265 × 100
    assert metrics["speedDeviationPct"] == 9.43
    assert "gazeRatio" not in metrics


def test_rescored_answer_speech_is_computed_from_tokens() -> None:
    target = job(answer(903, 1, evaluation()), answer(904, 2, None))
    metrics = run(target, FakeChat(GOOD, COVER_LETTER, COVER_LETTER))[0][-1]["speechMetrics"]
    computed = answer_speech(evaluate_answer_input(target.mode, target.answers[1]))
    assert metrics == aggregate_speech_metrics([SPEECH_1, computed])


def test_chat_interview_has_null_speech_metrics() -> None:
    target = job(answer(903, 1, evaluation(speech=None)), mode="CHAT")
    assert run(target)[0][-1]["speechMetrics"] is None


def broken(change: Any) -> dict[str, Any]:
    stored = evaluation()
    change(stored)
    return stored


BROKEN = [
    pytest.param(lambda e: e.pop("criteria"), id="criteria-missing"),
    pytest.param(lambda e: e["criteria"].pop("LOGIC"), id="criterion-missing"),
    pytest.param(lambda e: e["criteria"]["LOGIC"].update(level=4), id="level-out-of-range"),
    pytest.param(lambda e: e["criteria"]["LOGIC"].update(reason=" "), id="reason-blank"),
    pytest.param(lambda e: e["criteria"]["LOGIC"].update(score=95), id="score-above-level"),
    pytest.param(lambda e: e["criteria"]["LOGIC"].update(score=True), id="score-bool"),
    pytest.param(lambda e: e["criteria"]["LOGIC"].pop("scoreMethod"), id="method-missing"),
    pytest.param(lambda e: e.update(speech=[]), id="speech-not-object"),
    pytest.param(lambda e: e["speech"].update(fillerCount=True), id="metric-bool"),
    pytest.param(lambda e: e["speech"].update(speakingMs=-1), id="metric-negative"),
    pytest.param(lambda e: e["speech"].update(pitchRangeSt="6.2"), id="metric-text"),
]


@pytest.mark.parametrize("change", BROKEN)
def test_broken_stored_evaluation_is_scored_again(
    change: Any, caplog: pytest.LogCaptureFixture
) -> None:
    """형식이 다른 채점 결과는 실패로 처리하지 않고 다시 채점한다."""
    target = job(answer(903, 1, broken(change)))
    with caplog.at_level(logging.WARNING):
        messages, score, _ = run(target, FakeChat(GOOD, COVER_LETTER))
    assert messages[-1]["type"] == "evaluation.completed"
    assert len(score.calls) == 2
    assert "다시 채점한다 answerId=903" in caplog.text


def test_valid_stored_evaluation_passes_check() -> None:
    check_stored(evaluation())
    check_stored(evaluation(speech=None))
    check_stored(evaluation(speech={**SPEECH_1, "trailingOffRatio": None}))


def failed(messages: list[dict[str, Any]]) -> str:
    assert messages[-1]["type"] == "evaluation.failed"
    return cast(str, messages[-1]["reason"])


def test_gms_unavailable_publishes_failed() -> None:
    messages, _, _ = run(score=FakeChat(GmsUnavailableError("503")))
    assert failed(messages) == "GMS_UNAVAILABLE"


def test_broken_cover_letter_output_publishes_invalid_output() -> None:
    messages, score, _ = run(score=FakeChat({"COVER_LETTER": {"reason": "근거"}}, {}))
    assert failed(messages) == "INVALID_OUTPUT"
    assert len(score.calls) == 2


def test_broken_feedback_output_publishes_invalid_output() -> None:
    too_long = feedback_reply() | {"summary": "가" * 256}
    messages, _, written = run(written=FakeChat(too_long, GmsBadOutputError("JSON 아님")))
    assert failed(messages) == "INVALID_OUTPUT"
    assert len(written.calls) == 2


def test_publishes_timed_out_before_gms_call_after_be_wait_limit() -> None:
    score = FakeChat(COVER_LETTER, COVER_LETTER)
    handler, redis = make(score, FakeChat(), now=REQUESTED + ANALYSIS_TIMEOUT_SECONDS + 1)
    handler(JOB)
    assert failed(pushed(redis)) == "TIMED_OUT"
    assert score.calls == []


def test_completes_at_be_wait_limit() -> None:
    handler, redis = make(
        FakeChat(COVER_LETTER, COVER_LETTER),
        FakeChat(feedback_reply()),
        now=REQUESTED + ANALYSIS_TIMEOUT_SECONDS,
    )
    handler(JOB)
    assert pushed(redis)[-1]["type"] == "evaluation.completed"


def test_be_wait_limit_is_analysis_timeout() -> None:
    # BE application.yml ai-job.analysis-timeout: 10m
    assert ANALYSIS_TIMEOUT_SECONDS == 600.0


def test_missing_gms_settings_publishes_internal_error(caplog: pytest.LogCaptureFixture) -> None:
    client = lazy_gms_client(load_settings({}))
    handler, redis = make(gms_score_chat(client), gms_feedback_chat(client))
    with caplog.at_level(logging.ERROR):
        handler(JOB)
    assert failed(pushed(redis)) == "INTERNAL_ERROR"
    assert caplog.records[-1].exc_info is not None


def test_failure_log_records_versions(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.ERROR):
        run(score=FakeChat(COVER_LETTER, GmsUnavailableError("503")))
    assert "prompt=score-answer-v1,evaluate-cover-letter-v1,evaluate-feedback-v6" in caplog.text
    assert "model=gpt-judge,gpt-score" in caplog.text
    assert not caplog.records[-1].exc_info


def test_completion_log_records_feedback_model(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO):
        run()
    assert "model=gpt-feedback,gpt-judge,gpt-score" in caplog.text


@pytest.mark.parametrize(
    "fail_from",
    [
        pytest.param(0, id="progress"),
        pytest.param(3, id="completed"),
    ],
)
def test_result_publish_failure_is_raised(fail_from: int) -> None:
    """작업이 처리 중 리스트에 남아 다시 처리되도록 분배기까지 예외를 전파한다."""
    handler, _ = make(
        FakeChat(COVER_LETTER, COVER_LETTER), FakeChat(feedback_reply()), FailingRedis(fail_from)
    )
    with pytest.raises(ResultPublishError):
        handler(JOB)


def test_failed_result_publish_failure_is_raised() -> None:
    handler, _ = make(FakeChat(GmsUnavailableError("503")), FakeChat(), FailingRedis(1))
    with pytest.raises(ResultPublishError):
        handler(JOB)


def test_registered_as_evaluate_handler() -> None:
    dispatcher = Dispatcher()
    handler, redis = make(FakeChat(COVER_LETTER, COVER_LETTER), FakeChat(feedback_reply()))
    register_evaluate_handler(dispatcher, handler)
    assert dispatcher.dispatch(JOB) is DispatchResult.HANDLED
    assert pushed(redis)[-1]["type"] == "evaluation.completed"


def timeline_answer(answer_id: int, seq: int) -> dict[str, Any]:
    """30~35초에 자신감이 크게 떨어진 60초 답변(AI 명세 4장 다시보기 타임라인 입력)."""
    items = [
        {
            "atMs": s * 1000,
            "face": 0.9,
            **{key: 60.0 for key in ("stability", "expression", "emotion", "likeability")},
            "confidence": 10.0 if 30 <= s <= 35 else 60.0,
            "trust": 60.0,
        }
        for s in range(60)
    ]
    item = answer(answer_id, seq, evaluation())
    item["timeline"] = {
        "trailingOffAtMs": None,
        "impressions": {"promptVersion": "impression-v1", "modelVersion": "jev", "items": items},
    }
    return item


TIMELINE_REPLY = {
    "checkpoints": [
        {"id": "c1", "reasons": [{"metric": "CONFIDENCE", "text": "고개를 들고 말해 보세요."}]}
    ]
}


def test_video_answer_evaluation_has_timeline_with_gms_texts() -> None:
    """다시보기 타임라인은 결과 생성의 피드백 단계에서 함께 만든다(AI 명세 4장)."""
    target = job(timeline_answer(903, 1))
    written = FakeChat(feedback_reply(target), TIMELINE_REPLY)

    messages, _, _ = run(target, written=written)

    timeline = messages[-1]["answers"][0]["evaluation"]["timeline"]
    assert len(timeline["points"]) == 60
    [checkpoint] = timeline["checkpoints"]
    assert 30_000 <= checkpoint["atMs"] <= 35_000
    assert checkpoint["reasons"] == [
        {"metric": "CONFIDENCE", "count": None, "text": "고개를 들고 말해 보세요."}
    ]
    assert len(written.calls) == 2


def test_timeline_text_failure_does_not_fail_result() -> None:
    target = job(timeline_answer(903, 1))
    written = FakeChat(feedback_reply(target), GmsUnavailableError("503"))

    messages, _, _ = run(target, written=written)

    assert messages[-1]["type"] == "evaluation.completed"
    [checkpoint] = messages[-1]["answers"][0]["evaluation"]["timeline"]["checkpoints"]
    assert checkpoint["reasons"][0]["text"] == DEFAULT_TEXTS[Metric.CONFIDENCE]


def test_chat_answer_evaluation_has_no_timeline() -> None:
    target = job(answer(903, 1, evaluation(speech=None)), mode="CHAT")

    messages, _, _ = run(target)

    assert "timeline" not in messages[-1]["answers"][0]["evaluation"]


def test_answers_keep_job_order() -> None:
    target = replace(JOB, answers=tuple(reversed(JOB.answers)))
    completed = run(target)[0][-1]
    assert [a["answerId"] for a in completed["answers"]] == [904, 903]
