"""답변 채점 결과를 결과 큐로 전송한다(AI 명세 3장·5장).

채점 실패는 결과 생성에서 다시 처리하므로 결과 없이 작업을 종료한다.
결과 큐 전송 실패는 작업이 처리 중 리스트에 유지되도록 재전파한다.
"""

import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.common.answer import SpeechToken, SttGap, VoiceMetrics
from app.common.gms import (
    Chat,
    GmsBadOutputError,
    GmsClient,
    GmsResult,
    GmsUnavailableError,
    with_structure_retry,
)
from app.common.results import ResultPublisher, ResultType
from app.common.session import InterviewMode
from app.interview.scoring.judge import (
    PROMPT_VERSION,
    Criterion,
    Judgement,
    StructureBrokenError,
    build_judge_messages,
    parse_judgement,
    score_judgements,
)
from app.interview.speech import speech_metrics
from app.worker.dispatch import Dispatcher
from app.worker.messages import ScoreAnswerJob

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class AnswerInput:
    """작업 메시지에서 채점에 필요한 값만 분리한 입력."""

    answer_id: int
    mode: InterviewMode
    question: str
    criteria: str
    content: str
    tokens: Sequence[SpeechToken] | None
    voice: VoiceMetrics | None
    # STT가 끊겨 인식하지 못한 구간(AI 명세 3장).
    # 끊긴 적이 없으면 비어 있다
    stt_gaps: Sequence[SttGap] = ()


def score_answer_input(job: ScoreAnswerJob) -> AnswerInput:
    return AnswerInput(
        answer_id=job.answer_id,
        mode=job.mode,
        question=job.question,
        criteria=job.criteria,
        content=job.content,
        tokens=job.tokens,
        voice=job.speech,
        stt_gaps=job.stt_gaps,
    )


def answer_speech(answer: AnswerInput) -> dict[str, Any] | None:
    """화상 지표 여섯 개를 결합하며 계산하지 못한 값은 null로 유지한다."""
    if answer.mode is not InterviewMode.VIDEO:
        return None
    speech: dict[str, Any] = {
        "fillerCount": None,
        "speakingMs": None,
        "longPauseCount": None,
        "syllablesPerMin": None,
    }
    if answer.tokens:
        tokens = [token.to_json() for token in answer.tokens]
        speech.update(speech_metrics(tokens, answer.stt_gaps) or {})
    speech.update((answer.voice or VoiceMetrics(None, None)).to_json())
    return speech


def build_evaluation(answer: AnswerInput, chat: Chat) -> dict[str, Any]:
    """채점 결과를 생성하며 호출·검증 실패는 호출 측으로 전파한다."""
    speech = answer_speech(answer)
    messages = build_judge_messages(
        answer.question, answer.criteria, answer.content, speech, answer.stt_gaps
    )

    def attempt() -> tuple[GmsResult, dict[Criterion, Judgement]]:
        result = chat(messages)
        return result, parse_judgement(result)

    result, judged = with_structure_retry(
        attempt,
        retry_on=(GmsBadOutputError, StructureBrokenError),
        label=f"answerId={answer.answer_id}",
    )
    return {
        "criteria": score_judgements(judged),
        "speech": speech,
        "promptVersion": PROMPT_VERSION,
        "modelVersion": result.model,
    }


class ScoreAnswerJobHandler:
    def __init__(self, results: ResultPublisher, chat: Chat) -> None:
        self._results = results
        self._chat = chat

    def __call__(self, job: ScoreAnswerJob) -> None:
        try:
            evaluation = build_evaluation(score_answer_input(job), self._chat)
        except (GmsUnavailableError, GmsBadOutputError, StructureBrokenError) as error:
            log.error(
                "채점 실패, 결과 생성에서 다시 채점한다 answerId=%s jobId=%s error=%s",
                job.answer_id,
                job.job_id,
                type(error).__name__,
            )
            return
        except Exception:
            log.exception(
                "채점 중 예상하지 못한 오류 answerId=%s jobId=%s",
                job.answer_id,
                job.job_id,
            )
            return
        # 채점 실패와 달리 결과 전송 실패는 작업을 유지해야 하므로 예외 처리 범위 밖에 둔다.
        self._results.publish_job_result(
            job, ResultType.ANSWER_SCORED, {"answerId": job.answer_id, "evaluation": evaluation}
        )


def gms_score_chat(client: Callable[[], GmsClient]) -> Chat:
    """답변 채점과 결과 생성의 재채점·자소서 대조가 사용하는 GMS 호출 함수를 반환한다."""

    def call(messages: Sequence[Mapping[str, str]]) -> GmsResult:
        return client().chat_json(messages)

    return call


def register_score_answer_handler(dispatcher: Dispatcher, handler: ScoreAnswerJobHandler) -> None:
    dispatcher.register(ScoreAnswerJob, handler)
