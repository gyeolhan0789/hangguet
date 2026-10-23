"""분석 작업 메시지를 해석한다(AI 명세 1.3).

AI는 DB를 읽지 않으므로 BE가 작업에 필요한 내용을 메시지에 담아 전송한다.
작업별 필드는 AI 명세 2장(PLAN)·3장(SCORE_ANSWER)·4장(EVALUATE)·7장(MERGE_RECORDING)을 따른다.
- 형식이 틀린 메시지는 다시 수신해도 처리할 수 없으므로 InvalidJobError를 발생시킨다.
  큐 수신부는 job_header로 공통 필드를 읽을 수 있으면
  실패 결과(INVALID_JOB)를 전송하고 폐기한다(AI 명세 1.3).
- 명세에 없는 필드는 무시한다.
  고도화에서 회사 공시 요약(AI 명세 8장)이 추가돼도
  배포 순서와 관계없이 작업을 처리하게 하기 위함이다.
- 글자 수·토큰 수 상한은 BE가 답변을 저장할 때 검사하므로 여기서 다시 검사하지 않는다.
"""

import json
import math
import unicodedata
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, ClassVar

from app.common.session import InterviewMode


class JobType(StrEnum):
    PLAN = "PLAN"
    SCORE_ANSWER = "SCORE_ANSWER"
    EVALUATE = "EVALUATE"
    MERGE_RECORDING = "MERGE_RECORDING"


class ClaimType(StrEnum):
    """자소서 주장 종류(AI 명세 2장)."""

    EXPERIENCE = "EXPERIENCE"
    NUMBER = "NUMBER"


class InvalidJobError(ValueError):
    """작업 메시지 형식이 틀렸다."""


# AI 명세 2장: 질문은 seq 1~5로 정확히 5개다
MIN_SEQ = 1
MAX_SEQ = 5

# BE @NotBlank(Hibernate Validator 9)는 Java String.isBlank로 검사한다.
# isBlank는 Character.isWhitespace 기준이라 줄 바꿈 없는 공백(NBSP 등)을 공백으로 보지 않는다
JAVA_NON_BREAKING_SPACES = frozenset("\u00a0\u2007\u202f")
JAVA_CONTROL_WHITESPACE = frozenset("\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f")


@dataclass(frozen=True)
class SpeechToken:
    """STT가 확정한 토큰과 발화 시각(밀리초).

    단어 일부·공백을 포함한 원래 단위다.
    """

    text: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class VoiceMetrics:
    """면접 에이전트가 실시간 음성으로 계산한 말끝 흐림·억양 폭(AI 명세 3장, answers.speech).

    구하지 못한 값은 None이다.
    화상 답변 완료 메시지·채점 작업·결과 생성 작업이 같은 키를 사용한다.
    """

    trailing_off_ratio: float | None
    pitch_range_st: float | None

    def to_json(self) -> dict[str, float | None]:
        return {"trailingOffRatio": self.trailing_off_ratio, "pitchRangeSt": self.pitch_range_st}


@dataclass(frozen=True)
class Claim:
    id: str
    text: str
    type: ClaimType
    sentence_no: int


@dataclass(frozen=True)
class EvaluateAnswer:
    answer_id: int
    seq: int
    question: str
    criteria: str
    content: str
    tokens: tuple[SpeechToken, ...] | None
    # 채팅 답변과 음성 지표를 계산하지 못한 화상 답변은 None이다
    speech: VoiceMetrics | None
    # SCORE_ANSWER가 이미 채점한 결과(AI 명세 3장 evaluation)다.
    # 형식 검사는 결과 생성이 담당한다
    evaluation: Mapping[str, Any] | None


@dataclass(frozen=True, kw_only=True)
class Job:
    job_type: ClassVar[JobType]
    # 추적용이라 로그에 BE Outbox의 id와 같은 문자열로 남도록 수신한 값을 그대로 둔다
    job_id: str
    session_id: int
    # BE가 작업을 요청한 시각.
    # BE 최대 대기 시간의 시작이므로 AI도 이 시각부터 마감을 계산한다(AI 명세 1.3)
    requested_at: datetime


@dataclass(frozen=True, kw_only=True)
class PlanJob(Job):
    job_type: ClassVar[JobType] = JobType.PLAN
    company_name: str
    job_title: str
    cover_letter: str


@dataclass(frozen=True, kw_only=True)
class ScoreAnswerJob(Job):
    job_type: ClassVar[JobType] = JobType.SCORE_ANSWER
    answer_id: int
    mode: InterviewMode
    seq: int
    question: str
    criteria: str
    content: str
    # 채팅 답변과 STT 토큰이 없는 화상 답변은 None이다
    tokens: tuple[SpeechToken, ...] | None
    # 채팅 답변과 음성 지표를 계산하지 못한 화상 답변은 None이다
    speech: VoiceMetrics | None


@dataclass(frozen=True, kw_only=True)
class EvaluateJob(Job):
    job_type: ClassVar[JobType] = JobType.EVALUATE
    mode: InterviewMode
    cover_letter: str
    claims: tuple[Claim, ...]
    answers: tuple[EvaluateAnswer, ...]


@dataclass(frozen=True, kw_only=True)
class MergeRecordingJob(Job):
    job_type: ClassVar[JobType] = JobType.MERGE_RECORDING
    # BE가 녹화를 시작할 때 정한 원본 트랙 위치(BE 설계 10장 recordings/raw/{sessionId}/…)
    raw_prefix: str
    # 병합한 mp4를 업로드할 위치(BE 설계 10장 recordings/{sessionId}.mp4)
    object_key: str


def _int(data: Mapping[str, Any], key: str, path: str) -> int:
    value = data.get(key)
    # bool은 int의 하위 형식이므로 true가 1로 해석되지 않도록 형식을 정확히 비교한다
    if type(value) is not int:
        raise InvalidJobError(f"{path}{key}는 정수여야 한다")
    return value


def _positive_id(data: Mapping[str, Any], key: str, path: str = "") -> int:
    value = _int(data, key, path)
    if value <= 0:
        raise InvalidJobError(f"{path}{key}는 양의 정수여야 한다")
    return value


def _seq(data: Mapping[str, Any], path: str = "") -> int:
    value = _int(data, "seq", path)
    if not MIN_SEQ <= value <= MAX_SEQ:
        raise InvalidJobError(f"{path}seq는 {MIN_SEQ}~{MAX_SEQ} 사이여야 한다")
    return value


def _is_java_whitespace(char: str) -> bool:
    if char in JAVA_NON_BREAKING_SPACES:
        return False
    return char in JAVA_CONTROL_WHITESPACE or unicodedata.category(char) in ("Zs", "Zl", "Zp")


def _text(data: Mapping[str, Any], key: str, path: str = "") -> str:
    value = data.get(key)
    # 공백뿐인 글은 사용할 내용이 없으므로 빈 값과 같이 처리한다.
    # 공백 기준은 BE @NotBlank와 일치시킨다.
    # 더 넓은 str.strip을 사용하면 BE가 저장한 NBSP 답변 하나 때문에 결과 생성 작업 전체가 폐기된다
    if not isinstance(value, str) or all(_is_java_whitespace(char) for char in value):
        raise InvalidJobError(f"{path}{key}는 비어 있지 않은 문자열이어야 한다")
    return value


def _mode(data: Mapping[str, Any]) -> InterviewMode:
    try:
        return InterviewMode(str(data.get("mode")))
    except ValueError as e:
        raise InvalidJobError("mode는 VIDEO 또는 CHAT이어야 한다") from e


def _object(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise InvalidJobError(f"{path}는 JSON 객체여야 한다")
    return value


def _list(data: Mapping[str, Any], key: str) -> list[Any]:
    value = data.get(key)
    if not isinstance(value, list):
        raise InvalidJobError(f"{key}는 배열이어야 한다")
    return value


def _tokens(data: Mapping[str, Any], path: str = "") -> tuple[SpeechToken, ...] | None:
    value = data.get("tokens")
    if value is None:
        return None
    if not isinstance(value, list):
        raise InvalidJobError(f"{path}tokens는 배열이어야 한다")
    tokens = []
    for i, item in enumerate(value):
        where = f"{path}tokens[{i}]."
        token = _object(item, f"{path}tokens[{i}]")
        text = token.get("text")
        # 토큰은 공백 하나일 수 있으므로(단어 경계) 빈 문자열만 거부한다
        if not isinstance(text, str) or not text:
            raise InvalidJobError(f"{where}text는 비어 있지 않은 문자열이어야 한다")
        start_ms = _int(token, "startMs", where)
        end_ms = _int(token, "endMs", where)
        if start_ms < 0 or end_ms < start_ms:
            raise InvalidJobError(f"{where}endMs는 startMs 이상이고 startMs는 0 이상이어야 한다")
        tokens.append(SpeechToken(text, start_ms, end_ms))
    return tuple(tokens)


def _metric(data: Mapping[str, Any], key: str, path: str) -> float | None:
    value = data.get(key)
    if value is None:
        return None
    # bool은 int의 하위 형식이므로 true가 1로 해석되지 않도록 형식을 정확히 비교한다
    if type(value) not in (int, float) or not math.isfinite(value):
        raise InvalidJobError(f"{path}{key}는 유한한 숫자 또는 null이어야 한다")
    return float(value)


def _speech(data: Mapping[str, Any], path: str = "") -> VoiceMetrics | None:
    value = data.get("speech")
    if value is None:
        return None
    where = f"{path}speech."
    speech = _object(value, f"{path}speech")
    return VoiceMetrics(
        trailing_off_ratio=_metric(speech, "trailingOffRatio", where),
        pitch_range_st=_metric(speech, "pitchRangeSt", where),
    )


def _claims(data: Mapping[str, Any]) -> tuple[Claim, ...]:
    claims = []
    for i, item in enumerate(_list(data, "claims")):
        path = f"claims[{i}]."
        claim = _object(item, f"claims[{i}]")
        try:
            claim_type = ClaimType(str(claim.get("type")))
        except ValueError as e:
            raise InvalidJobError(f"{path}type은 EXPERIENCE 또는 NUMBER여야 한다") from e
        claims.append(
            Claim(
                id=_text(claim, "id", path),
                text=_text(claim, "text", path),
                type=claim_type,
                sentence_no=_positive_id(claim, "sentenceNo", path),
            )
        )
    # 질문이 claimId로 주장을 가리키므로(AI 명세 2장) 같은 id가 두 번 있으면 대조 대상이 모호하다
    if len({claim.id for claim in claims}) != len(claims):
        raise InvalidJobError("claims의 id가 중복된다")
    return tuple(claims)


def _evaluate_answers(data: Mapping[str, Any]) -> tuple[EvaluateAnswer, ...]:
    items = _list(data, "answers")
    # 면접 끝내기 API(5.8)는 답변이 1개 이상일 때만 결과 생성을 요청한다(AI 명세 4장)
    if not items:
        raise InvalidJobError("answers는 답변이 하나 이상이어야 한다")
    answers = []
    for i, item in enumerate(items):
        path = f"answers[{i}]."
        answer = _object(item, f"answers[{i}]")
        evaluation = answer.get("evaluation")
        if evaluation is not None and not isinstance(evaluation, dict):
            raise InvalidJobError(f"{path}evaluation은 JSON 객체 또는 null이어야 한다")
        answers.append(
            EvaluateAnswer(
                answer_id=_positive_id(answer, "answerId", path),
                seq=_seq(answer, path),
                question=_text(answer, "question", path),
                criteria=_text(answer, "criteria", path),
                content=_text(answer, "content", path),
                tokens=_tokens(answer, path),
                speech=_speech(answer, path),
                evaluation=evaluation,
            )
        )
    # 질문 하나에 답변 하나이므로(answers.question_id UNIQUE)
    # 같은 seq·answerId가 두 번 오면 항목 평균이 한 답변 쪽으로 편향된다
    if len({a.seq for a in answers}) != len(answers):
        raise InvalidJobError("answers의 seq가 중복된다")
    if len({a.answer_id for a in answers}) != len(answers):
        raise InvalidJobError("answers의 answerId가 중복된다")
    return tuple(answers)


def _merge_locations(data: Mapping[str, Any], session_id: int) -> tuple[str, str]:
    raw_prefix = _text(data, "rawPrefix")
    object_key = _text(data, "objectKey")
    # 다른 면접의 녹화를 읽거나 덮어쓰지 않도록 BE 설계 10장의 키 규칙과 같은지 확인한다
    if not raw_prefix.startswith(f"recordings/raw/{session_id}/"):
        raise InvalidJobError("rawPrefix는 recordings/raw/{sessionId}/로 시작해야 한다")
    if object_key != f"recordings/{session_id}.mp4":
        raise InvalidJobError("objectKey는 recordings/{sessionId}.mp4여야 한다")
    return raw_prefix, object_key


def _timestamp(data: Mapping[str, Any], key: str) -> datetime:
    value = data.get(key)
    if not isinstance(value, str):
        raise InvalidJobError(f"{key}는 ISO 8601 시각 문자열이어야 한다")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as e:
        raise InvalidJobError(f"{key}는 ISO 8601 시각 문자열이어야 한다") from e
    # 시간대가 없으면 서버 시간대에 따라 마감이 달라지므로 오프셋이 있는 시각만 받는다
    if parsed.utcoffset() is None:
        raise InvalidJobError(f"{key}는 시간대 오프셋이 있어야 한다")
    return parsed


def _job_id(data: Mapping[str, Any]) -> str:
    value = data.get("jobId")
    if not isinstance(value, str):
        raise InvalidJobError("jobId는 UUID 문자열이어야 한다")
    try:
        uuid.UUID(value)
    except ValueError as e:
        raise InvalidJobError("jobId는 UUID 문자열이어야 한다") from e
    return value


@dataclass(frozen=True)
class JobHeader:
    """모든 작업에 있는 공통 필드(AI 명세 1.3)."""

    job_type: JobType
    job_id: str
    session_id: int


def _load(raw: str | bytes | Mapping[str, Any]) -> Mapping[str, Any]:
    if isinstance(raw, Mapping):
        data: Any = raw
    else:
        # 지나치게 깊이 중첩된 JSON은 RecursionError가 발생한다.
        # 형식 오류로 처리하지 않으면
        # 작업자가 종료되고 재시작할 때 같은 메시지를 다시 수신해 종료가 반복된다
        try:
            data = json.loads(raw)
        except (ValueError, RecursionError) as e:
            raise InvalidJobError("JSON이 아니다") from e
    if not isinstance(data, Mapping):
        raise InvalidJobError("JSON 객체가 아니다")
    return data


def _header(data: Mapping[str, Any]) -> JobHeader:
    try:
        job_type = JobType(str(data.get("jobType")))
    except ValueError as e:
        raise InvalidJobError("jobType을 알 수 없다") from e
    return JobHeader(job_type, _job_id(data), _positive_id(data, "sessionId"))


def job_header(raw: str | bytes | Mapping[str, Any]) -> JobHeader | None:
    """형식이 틀린 작업에서 공통 필드만 해석한다.

    공통 필드도 틀리면 None을 반환한다.
    공통 필드를 읽을 수 있으면 실패 결과를 그 작업 앞으로 전송할 수 있다(AI 명세 1.3).
    """
    try:
        return _header(_load(raw))
    except InvalidJobError:
        return None


def parse_job(raw: str | bytes | Mapping[str, Any]) -> Job:
    data = _load(raw)
    header = _header(data)
    job_type, job_id, session_id = header.job_type, header.job_id, header.session_id
    requested_at = _timestamp(data, "requestedAt")
    match job_type:
        case JobType.PLAN:
            return PlanJob(
                job_id=job_id,
                session_id=session_id,
                requested_at=requested_at,
                company_name=_text(data, "companyName"),
                job_title=_text(data, "jobTitle"),
                cover_letter=_text(data, "coverLetter"),
            )
        case JobType.SCORE_ANSWER:
            return ScoreAnswerJob(
                job_id=job_id,
                session_id=session_id,
                requested_at=requested_at,
                answer_id=_positive_id(data, "answerId"),
                mode=_mode(data),
                seq=_seq(data),
                question=_text(data, "question"),
                criteria=_text(data, "criteria"),
                content=_text(data, "content"),
                tokens=_tokens(data),
                speech=_speech(data),
            )
        case JobType.EVALUATE:
            return EvaluateJob(
                job_id=job_id,
                session_id=session_id,
                requested_at=requested_at,
                mode=_mode(data),
                cover_letter=_text(data, "coverLetter"),
                claims=_claims(data),
                answers=_evaluate_answers(data),
            )
        case JobType.MERGE_RECORDING:
            raw_prefix, object_key = _merge_locations(data, session_id)
            return MergeRecordingJob(
                job_id=job_id,
                session_id=session_id,
                requested_at=requested_at,
                raw_prefix=raw_prefix,
                object_key=object_key,
            )
