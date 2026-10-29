"""결과 생성 작업(EVALUATE) 처리 함수.

분석 작업자의 분배기에 EvaluateJob으로 등록한다.
AI는 DB에 접속하지 않으므로 결과를 결과 메시지로만 전송한다.
저장·이전 결과 삭제·상태 변경은 BE가 evaluation.completed를 한 트랜잭션으로 처리한다(AI 명세 4장).
- 단계가 변경될 때마다 evaluation.progress를 전송한다(AI 명세 4장).
- 결과를 생성하지 못하면 evaluation.failed를 전송하고 작업을 마친다.
  다시 처리해도 같은 실패가 반복되므로, 재시도는 결과 재생성 API(5.9)가 등록하는 새 작업으로만 한다.
- BE 대기 상한(10분)이 지나면 GMS를 호출하기 전에 중단하고 evaluation.failed(TIMED_OUT)를 전송한다.
  BE가 FAILED로 처리할 작업에 GMS 비용과 대기 중인 다른 작업의 처리 시간을 사용하지 않기 위함이다.
- 결과 큐 전송이 재시도 후에도 실패하면 ResultPublishError를 재전파한다.
  실패 메시지도 전송할 수 없으므로 작업을 처리 중 리스트에 남겨 작업자를 다시 시작할 때 처리한다.
- 같은 작업을 두 번 처리해 결과를 두 번 전송해도
  BE가 상태와 jobId로 늦은 결과를 폐기한다(AI 명세 1.4).
"""

import logging
import math
import time
from collections.abc import Callable, Mapping, Sequence
from enum import StrEnum
from typing import Any

from app.common.cover_letter import cover_letter_text
from app.common.gms import (
    Chat,
    GmsBadOutputError,
    GmsDeadlineError,
    GmsUnavailableError,
    with_deadline,
)
from app.common.results import (
    REASON,
    FailureReason,
    ResultPublisher,
    ResultPublishError,
    ResultType,
)
from app.common.session import InterviewMode
from app.interview.result import cover_letter, feedback
from app.interview.result.cover_letter import (
    CoverLetterInput,
    confirm_cover_letter,
    judge_cover_letter,
)
from app.interview.result.feedback import AnswerForFeedback, SessionForFeedback, write_feedback
from app.interview.result.scores import answer_score, session_scores
from app.interview.scoring import judge
from app.interview.scoring.job import AnswerInput, build_evaluation
from app.interview.scoring.judge import Criterion, StructureBrokenError, parse_item
from app.interview.scoring.score import LEVEL_SCORES, ScoreMethod
from app.interview.speech import aggregate_speech_metrics
from app.worker.dispatch import Dispatcher
from app.worker.messages import EvaluateAnswer, EvaluateJob

log = logging.getLogger(__name__)

# BE 최대 대기 시간(BE 설계 5.4, ai-job.analysis-timeout, AI 명세 5장)과 같은 값이다.
# BE가 작업을 요청한 시각(requestedAt)부터 계산해 큐에서 대기한 시간까지 포함한다(AI 명세 5장)
ANALYSIS_TIMEOUT_SECONDS = 600.0
# 점수는 판정 단계 점수의 기대값이므로 가장 낮은 단계와 가장 높은 단계의 점수 사이다(AI 명세 3장)
_SCORE_RANGE = range(min(LEVEL_SCORES.values()), max(LEVEL_SCORES.values()) + 1)
_SCORE_METHODS = frozenset(method.value for method in ScoreMethod)
# 답변 채점이 화상 답변마다 기록하는 말하기 지표(AI 명세 3장)
_SPEECH_KEYS = (
    "fillerCount",
    "speakingMs",
    "longPauseCount",
    "syllablesPerMin",
    "trailingOffRatio",
    "pitchRangeSt",
)


class AnalysisStep(StrEnum):
    """evaluation.progress의 analysisStep 값(API 명세 5.2, BE AnalysisStep)."""

    ORGANIZING_ANSWERS = "ORGANIZING_ANSWERS"
    SCORING = "SCORING"
    WRITING_FEEDBACK = "WRITING_FEEDBACK"


class StoredEvaluationError(ValueError):
    """작업 메시지의 evaluation(답변 채점이 이미 채점한 결과) 형식이 AI 명세 3장과 다르다."""


def evaluate_answer_input(mode: InterviewMode, answer: EvaluateAnswer) -> AnswerInput:
    return AnswerInput(
        answer_id=answer.answer_id,
        mode=mode,
        question=answer.question,
        criteria=answer.criteria,
        content=answer.content,
        tokens=answer.tokens,
        voice=answer.speech,
    )


def _is_metric(value: object) -> bool:
    # bool은 int에 속하므로 true를 1로 집계하지 않도록 제외한다.
    return (
        isinstance(value, int | float)
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    )


def check_stored(evaluation: Mapping[str, Any]) -> None:
    """결과에 그대로 전송하거나 집계에 사용하는 값의 형식을 검사한다.

    BE가 전달한 점수를 결과 점수로 전송하므로 점수 범위와 항목별 scoreMethod까지 확인한다.
    """
    criteria = evaluation.get("criteria")
    if not isinstance(criteria, dict):
        raise StoredEvaluationError("criteria가 없다")
    for criterion in Criterion:
        try:
            parse_item(criteria, criterion)
        except StructureBrokenError as e:
            raise StoredEvaluationError(str(e)) from e
        item = criteria[criterion.value]
        score = item.get("score")
        if type(score) is not int or score not in _SCORE_RANGE:
            raise StoredEvaluationError(f"{criterion} 점수가 범위 밖이다: {score!r}")
        if item.get("scoreMethod") not in _SCORE_METHODS:
            raise StoredEvaluationError(f"{criterion} scoreMethod가 유효하지 않다")
    speech = evaluation.get("speech")
    if speech is None:
        return
    if not isinstance(speech, dict):
        raise StoredEvaluationError("speech가 JSON 객체가 아니다")
    for key in _SPEECH_KEYS:
        value = speech.get(key)
        if value is not None and not _is_metric(value):
            raise StoredEvaluationError(f"speech.{key}가 0 이상의 수가 아니다")


def _stored_evaluation(answer: EvaluateAnswer) -> dict[str, Any] | None:
    """이미 채점한 결과를 사용할 수 있으면 반환하고, 형식이 다르면 None을 반환한다.

    형식이 다른 값은 실패로 처리하지 않고 다시 채점한다.
    BE는 answers.evaluation이 비어 있을 때만 채점 결과를 저장하므로,
    실패로 처리하면 결과를 재생성해도 같은 값이 다시 전달돼 결과를 생성할 수 없다.
    """
    if answer.evaluation is None:
        return None
    evaluation = dict(answer.evaluation)
    try:
        check_stored(evaluation)
    except StoredEvaluationError as e:
        log.warning(
            "이미 채점한 결과의 형식이 달라 다시 채점한다 answerId=%s: %s", answer.answer_id, e
        )
        return None
    return evaluation


def _organize(job: EvaluateJob, chat: Chat, models: set[str]) -> list[dict[str, Any]]:
    """evaluation이 null인 답변만 채점하고, 이미 있는 값은 유지한다(AI 명세 4장 답변 정리).

    말하기 지표도 채점 결과의 speech를 그대로 집계한다.
    전달력 판정에 사용한 값과 면접 단위 지표가 같은 값에서 계산되게 하기 위함이다.
    """
    evaluations = []
    for answer in job.answers:
        evaluation = _stored_evaluation(answer)
        if evaluation is None:
            evaluation = build_evaluation(evaluate_answer_input(job.mode, answer), chat)
        if isinstance(model := evaluation.get("modelVersion"), str):
            models.add(model)
        evaluations.append(evaluation)
    return evaluations


def _confirm_cover_letters(
    job: EvaluateJob, evaluations: Sequence[Mapping[str, Any]], chat: Chat, models: set[str]
) -> list[dict[str, Any]]:
    confirmed = []
    for answer, evaluation in zip(job.answers, evaluations, strict=True):
        source = CoverLetterInput(
            answer_id=answer.answer_id,
            cover_letter=cover_letter_text(job.cover_letter_items),
            claims=job.claims,
            question=answer.question,
            content=answer.content,
        )
        result = judge_cover_letter(source, chat)
        models.add(result.model)
        confirmed.append(confirm_cover_letter(evaluation, result))
    return confirmed


def build_result(
    job: EvaluateJob,
    results: ResultPublisher,
    score_chat: Chat,
    feedback_chat: Chat,
    models: set[str],
) -> dict[str, Any]:
    """evaluation.completed의 내용을 계산하며 단계마다 evaluation.progress를 전송한다."""

    def progress(step: AnalysisStep) -> None:
        results.publish_job_result(
            job, ResultType.EVALUATION_PROGRESS, {"analysisStep": step.value}
        )

    progress(AnalysisStep.ORGANIZING_ANSWERS)
    evaluations = _organize(job, score_chat, models)
    speech = (
        aggregate_speech_metrics([e.get("speech") for e in evaluations])
        if job.mode is InterviewMode.VIDEO
        else None
    )

    progress(AnalysisStep.SCORING)
    # 확정한 자소서 검증 점수로 평균을 계산해야 하므로 점수 계산보다 먼저 확정한다(AI 명세 4장)
    evaluations = _confirm_cover_letters(job, evaluations, score_chat, models)
    scores = session_scores([e["criteria"] for e in evaluations])

    progress(AnalysisStep.WRITING_FEEDBACK)
    session = SessionForFeedback(
        answers=[
            AnswerForFeedback(a.answer_id, a.seq, a.question, a.content, e["criteria"])
            for a, e in zip(job.answers, evaluations, strict=True)
        ],
        scores=scores,
        earlier_summaries=job.earlier_summaries,
    )
    written = write_feedback(session, feedback_chat)
    models.add(written.model)
    return {
        "answers": [
            {
                "answerId": a.answer_id,
                "score": answer_score(e["criteria"]),
                "goodPoint": written.answers[a.answer_id].good_point,
                "improvePoint": written.answers[a.answer_id].improve_point,
                "evaluation": e,
            }
            for a, e in zip(job.answers, evaluations, strict=True)
        ],
        "sessionScores": [
            {"criterion": c.value, "score": scores[c], "comment": written.comments[c]}
            for c in Criterion
        ],
        # 화상 면접만 speech_metrics 행을 저장한다(AI 명세 4장).
        # 채팅은 null이다
        "speechMetrics": speech,
        "headline": written.headline,
        "summary": written.summary,
    }


def _versions(models: set[str]) -> str:
    # AI 명세 9장: EVALUATE는 사용한 Prompt·Model 버전을 로그에만 남긴다
    prompts = (judge.PROMPT_VERSION, cover_letter.PROMPT_VERSION, feedback.PROMPT_VERSION)
    return f"prompt={','.join(prompts)} model={','.join(sorted(models)) or '-'}"


class EvaluateJobHandler:
    def __init__(
        self,
        results: ResultPublisher,
        score_chat: Chat,
        feedback_chat: Chat,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._results = results
        self._score_chat = score_chat
        self._feedback_chat = feedback_chat
        self._clock = clock

    def __call__(self, job: EvaluateJob) -> None:
        models: set[str] = set()
        deadline = job.requested_at.timestamp() + ANALYSIS_TIMEOUT_SECONDS
        try:
            body = build_result(
                job,
                self._results,
                with_deadline(self._score_chat, deadline, self._clock),
                with_deadline(self._feedback_chat, deadline, self._clock),
                models,
            )
        except ResultPublishError:
            raise
        except GmsUnavailableError as e:
            self._fail(job, FailureReason.GMS_UNAVAILABLE, e, models)
            return
        except (GmsBadOutputError, StructureBrokenError) as e:
            self._fail(job, FailureReason.INVALID_OUTPUT, e, models)
            return
        except GmsDeadlineError as e:
            self._fail(job, FailureReason.TIMED_OUT, e, models)
            return
        except Exception as e:
            self._fail(job, FailureReason.INTERNAL_ERROR, e, models)
            return
        self._results.publish_job_result(job, ResultType.EVALUATION_COMPLETED, body)
        log.info(
            "결과 생성 완료 sessionId=%s jobId=%s %s", job.session_id, job.job_id, _versions(models)
        )

    def _fail(
        self, job: EvaluateJob, reason: FailureReason, error: Exception, models: set[str]
    ) -> None:
        # 원인이 분명하지 않은 오류만 추적 정보를 남긴다
        log.error(
            "결과 생성 실패 reason=%s sessionId=%s jobId=%s %s: %r",
            reason,
            job.session_id,
            job.job_id,
            _versions(models),
            error,
            exc_info=reason is FailureReason.INTERNAL_ERROR,
        )
        self._results.publish_job_result(job, ResultType.EVALUATION_FAILED, {REASON: reason.value})


def register_evaluate_handler(dispatcher: Dispatcher, handler: EvaluateJobHandler) -> None:
    dispatcher.register(EvaluateJob, handler)
