"""면접 에이전트가 결과 큐로 BE에 전달하는 질문 시작·답변 완료 메시지를 생성한다.

기준: AI 명세 1.4·6.2(question.started·answer.completed의 필드와 범위).
- 에이전트가 질문 음성을 시작하는 시점에는 BE가 질문 행을 아직 생성하지 않았으므로,
  질문은 seq로 가리킨다.
  BE는 question.started를 수신할 때 질문 행을 생성한다.
- BE가 같은 seq의 질문 행이나 답변이 이미 있으면 폐기하므로 멱등 키를 포함하지 않는다.
- 전송은 분석 작업자와 같은 결과 메시지 전송기(app.common.results)를 사용한다.
  두 메시지는 작업 결과가 아니므로 jobId가 없다.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from app.common.answer import SpeechToken, SttGap, VoiceMetrics, is_java_blank
from app.common.results import KST, ResultPublisher, ResultType
from app.common.session import GROUP_MAX_SEQ, MAX_SEQ, MIN_SEQ
from app.interview.realtime.transcript import MAX_ANSWER_TOKENS

# AI 명세 6.2: 화상 답변 글은 1~10,000자다
MAX_CONTENT_LENGTH = 10_000


class EndReason(StrEnum):
    """답변이 끝난 이유(AI 명세 6.2 endReason)."""

    AUTO_SUBMIT = "AUTO_SUBMIT"  # 마지막 발화 뒤 침묵으로 자동 제출
    MANUAL_SUBMIT = "MANUAL_SUBMIT"  # 지원자가 [답변 완료]를 누름
    STT_FAILED = "STT_FAILED"  # STT에 다시 연결하지 못해 그때까지 인식된 글로 제출(AI 명세 6.5)
    # 그룹 면접 답변 마감(deadlineAt)에 그때까지 인식된 글로 제출(AI 명세 6.7)
    TIME_LIMIT = "TIME_LIMIT"


class ProgressMessageError(ValueError):
    """BE가 저장할 수 없는 값이라 결과 메시지를 생성하지 않는다."""


@dataclass(frozen=True)
class ProgressMessage:
    type: ResultType
    session_id: int
    fields: Mapping[str, Any]

    def publish(self, publisher: ResultPublisher) -> None:
        """결과 큐에 전송한다.

        재시도까지 실패하면 ResultPublishError가 전파된다.
        """
        publisher.publish(self.type, self.session_id, self.fields)


def _check_target(session_id: int, seq: int, max_seq: int = MAX_SEQ) -> None:
    if session_id <= 0:
        raise ProgressMessageError("sessionId는 양의 정수여야 한다")
    if not MIN_SEQ <= seq <= max_seq:
        raise ProgressMessageError(f"seq는 {MIN_SEQ}~{max_seq} 사이여야 한다")


def _java_length(text: str) -> int:
    # BE는 Java String.length(UTF-16 단위)로 길이를 검사하므로 같은 기준으로 계산한다.
    # 그림 문자처럼 UTF-16 두 단위인 글자가 있으면 Python len과 결과가 다르다
    return len(text.encode("utf-16-le")) // 2


def _token_json(tokens: tuple[SpeechToken, ...]) -> list[dict[str, Any]]:
    if len(tokens) > MAX_ANSWER_TOKENS:
        raise ProgressMessageError(f"tokens는 {MAX_ANSWER_TOKENS:,}개 이하여야 한다")
    result = []
    for token in tokens:
        if token.start_ms < 0 or token.end_ms < token.start_ms:
            raise ProgressMessageError("tokens는 0 ≤ startMs ≤ endMs여야 한다")
        result.append(token.to_json())
    return result


def _trailing_json(times: tuple[int, ...]) -> list[int]:
    # 흐린 문장은 문장 수를 넘을 수 없어 토큰 수 상한을 함께 쓴다(AI 명세 6.2)
    if len(times) > MAX_ANSWER_TOKENS:
        raise ProgressMessageError(f"trailingOffAtMs는 {MAX_ANSWER_TOKENS:,}개 이하여야 한다")
    if any(ms < 0 for ms in times):
        raise ProgressMessageError("trailingOffAtMs는 0 이상이어야 한다")
    return sorted(times)


def _timestamp(value: datetime, name: str) -> str:
    if value.utcoffset() is None:
        raise ProgressMessageError(f"{name}은 시간대가 있는 시각이어야 한다")
    # 다시보기에서 영상 0초(recordingStartedAt)와의 차이로 위치를 구하므로
    # 밀리초까지 기록한다(AI 명세 6.2)
    return value.astimezone(KST).isoformat(timespec="milliseconds")


def question_started(
    session_id: int,
    seq: int,
    started_at: datetime,
    content: str,
    criteria: str,
    *,
    prompt_version: str | None = None,
    model_version: str | None = None,
    max_seq: int = MAX_SEQ,
) -> ProgressMessage:
    """질문 음성을 시작한 시각과 실제로 출제한 질문을 전달한다.

    BE는 이 시각을 질문 행의 생성 시각으로, content·criteria를 질문 글·채점 기준으로 저장한다.
    2·4·5번은 꼬리질문이거나 예비 질문이라 플랜과 다를 수 있기 때문이다(AI 명세 6.2).
    prompt_version·model_version은 꼬리질문이면 생성 버전이고, 미리 만든 질문이면 None이다.
    max_seq는 질문 번호 상한이다(그룹 면접은 GROUP_MAX_SEQ).
    """
    _check_target(session_id, seq, max_seq)
    return ProgressMessage(
        ResultType.QUESTION_STARTED,
        session_id,
        {
            "seq": seq,
            "startedAt": _timestamp(started_at, "startedAt"),
            "content": content,
            "criteria": criteria,
            "promptVersion": prompt_version,
            "modelVersion": model_version,
        },
    )


def check_answer_content(content: str) -> None:
    """BE가 저장할 수 있는 답변 글인지 확인한다.

    빈 글이나 10,000자를 넘는 글이면 ProgressMessageError다.
    """
    # BE가 answer.completed 답변 글을 String.isBlank로 검사하므로(AiResultService),
    # NBSP만 있는 글은 거부하지 않는다
    if is_java_blank(content):
        raise ProgressMessageError("답변 글이 비었다")
    if _java_length(content) > MAX_CONTENT_LENGTH:
        raise ProgressMessageError(f"답변 글이 {MAX_CONTENT_LENGTH:,}자를 넘는다")


def answer_completed(
    session_id: int,
    seq: int,
    answer_started_at: datetime,
    content: str,
    tokens: tuple[SpeechToken, ...] | None,
    speech: VoiceMetrics | None,
    end_reason: EndReason,
    *,
    trailing_off_at_ms: tuple[int, ...] | None = None,
    impressions: Mapping[str, Any] | None = None,
    stt_gaps: tuple[SttGap, ...] = (),
    max_seq: int = MAX_SEQ,
) -> ProgressMessage:
    """화상 답변의 전사 결과와 실시간 음성 지표를 전달한다.

    answer_started_at은 그 답변을 듣기 시작한 시각이고 tokens 시각의 0ms다(AI 명세 6.2).
    빈 답변과 10,000자를 넘는 답변은 메시지를 생성하지 않고 실패로 처리한다.
    길이를 넘는 답변을 잘라 전달하지 않는 이유는 채점 대상 글이 변경되기 때문이다.
    tokens가 None이면 null로 전달하고, 이 경우 BE에서 말하기 지표만 비게 된다.
    speech가 None이면 두 지표를 모두 null로 전달한다.
    다시보기 타임라인용 trailing_off_at_ms·impressions는 speech에 함께 담고, 없으면 null이다.
    STT가 끊겨 인식하지 못한 구간은 sttGaps로 담고, 끊긴 적이 없으면 null이다(AI 명세 6.2).
    """
    _check_target(session_id, seq, max_seq)
    check_answer_content(content)
    return ProgressMessage(
        ResultType.ANSWER_COMPLETED,
        session_id,
        {
            "seq": seq,
            "answerStartedAt": _timestamp(answer_started_at, "answerStartedAt"),
            "content": content,
            "tokens": None if tokens is None else _token_json(tokens),
            "speech": {
                **(speech or VoiceMetrics(None, None)).to_json(),
                "trailingOffAtMs": None
                if trailing_off_at_ms is None
                else _trailing_json(trailing_off_at_ms),
                "impressions": impressions,
            },
            "sttGaps": [gap.to_json() for gap in stt_gaps] if stt_gaps else None,
            "endReason": EndReason(end_reason).value,
        },
    )


class SpeechResult(StrEnum):
    """질문 음성이 끝난 방식(AI 명세 6.7 question.spoken speech)."""

    ENDED = "ENDED"
    FAILED = "FAILED"


def group_question_started(
    session_id: int,
    seq: int,
    started_at: datetime,
    content: str,
    criteria: str,
    *,
    turn_version: int,
    kind: str,
    speech_ms: int,
    prompt_version: str | None = None,
    model_version: str | None = None,
) -> ProgressMessage:
    """그룹 면접의 question.started(AI 명세 6.7).

    받은 방 정보의 turnVersion · 차례 종류 kind · 질문 음성 길이 speechMs를 더한다.
    음성 없이 출제하면 speech_ms는 0이다.
    """
    if speech_ms < 0:
        raise ProgressMessageError("speechMs는 0 이상이어야 한다")
    message = question_started(
        session_id,
        seq,
        started_at,
        content,
        criteria,
        prompt_version=prompt_version,
        model_version=model_version,
        max_seq=GROUP_MAX_SEQ,
    )
    return _with(message, turnVersion=turn_version, kind=kind, speechMs=speech_ms)


def question_spoken(
    session_id: int, seq: int, *, turn_version: int, ended_at: datetime, speech: SpeechResult
) -> ProgressMessage:
    """그룹 면접의 질문 음성이 끝났거나 실패했음을 전달한다(AI 명세 6.7 question.spoken).

    BE는 ended_at부터 답변 시간을 센다.
    """
    _check_target(session_id, seq, GROUP_MAX_SEQ)
    return ProgressMessage(
        ResultType.QUESTION_SPOKEN,
        session_id,
        {
            "seq": seq,
            "turnVersion": turn_version,
            "endedAt": _timestamp(ended_at, "endedAt"),
            "speech": SpeechResult(speech).value,
        },
    )


def group_answer_completed(
    session_id: int,
    seq: int,
    answer_started_at: datetime,
    content: str,
    tokens: tuple[SpeechToken, ...] | None,
    speech: VoiceMetrics | None,
    end_reason: EndReason,
    *,
    turn_version: int,
    answer_ended_at: datetime,
    trailing_off_at_ms: tuple[int, ...] | None = None,
    impressions: Mapping[str, Any] | None = None,
    stt_gaps: tuple[SttGap, ...] = (),
) -> ProgressMessage:
    """그룹 면접의 answer.completed(AI 명세 6.7).

    turnVersion과 답변을 끝낸 시각 answerEndedAt을 더한다.
    """
    message = answer_completed(
        session_id,
        seq,
        answer_started_at,
        content,
        tokens,
        speech,
        end_reason,
        trailing_off_at_ms=trailing_off_at_ms,
        impressions=impressions,
        stt_gaps=stt_gaps,
        max_seq=GROUP_MAX_SEQ,
    )
    return _with(
        message,
        turnVersion=turn_version,
        answerEndedAt=_timestamp(answer_ended_at, "answerEndedAt"),
    )


def followup_not_needed(
    session_id: int, seq: int, *, turn_version: int, received_at: datetime
) -> ProgressMessage:
    """그룹 면접의 followup.decided 중 꼬리질문이 필요 없다는 판단(AI 명세 6.7).

    GMS를 부르지 않았으므로 generationMs는 null이다.
    """
    _check_target(session_id, seq, GROUP_MAX_SEQ)
    return ProgressMessage(
        ResultType.FOLLOWUP_DECIDED,
        session_id,
        {
            "seq": seq,
            "turnVersion": turn_version,
            "needed": False,
            "content": None,
            "criteria": None,
            "promptVersion": None,
            "modelVersion": None,
            "receivedAt": _timestamp(received_at, "receivedAt"),
            "generationMs": None,
        },
    )


def _with(message: ProgressMessage, **fields: Any) -> ProgressMessage:
    return ProgressMessage(message.type, message.session_id, {**message.fields, **fields})
