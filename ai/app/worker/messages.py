"""분석 작업 메시지를 해석한다(AI 명세 1.3).

AI는 DB를 읽지 않으므로 BE가 작업에 필요한 내용을 메시지에 담아 전송한다.
작업별 필드는 AI 명세 2장(PLAN)·3장(SCORE_ANSWER)·4장(EVALUATE)·7장(MERGE_RECORDING)을 따른다.
- 주장 추출(EXTRACT_CLAIMS, AI 명세 2장)은 면접이 아니라 지원서 단위 작업이므로
  sessionId 대신 applicationId를 담는다(AI 명세 1.3).
- 형식이 틀린 메시지는 다시 수신해도 처리할 수 없으므로 InvalidJobError를 발생시킨다.
  큐 수신부는 job_header로 공통 필드를 읽을 수 있으면
  실패 결과(INVALID_JOB)를 전송하고 폐기한다(AI 명세 1.3).
- 명세에 없는 필드는 무시한다.
  고도화에서 필드가 추가돼도 배포 순서와 관계없이 작업을 처리하게 하기 위함이다.
- 글자 수·토큰 수 상한은 BE가 답변을 저장할 때 검사하므로 여기서 다시 검사하지 않는다.
"""

import json
import logging
import math
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, ClassVar

from app.common.answer import (
    ImpressionSample,
    SpeechToken,
    SttGap,
    TimelineInput,
    VoiceMetrics,
    is_java_blank,
)
from app.common.cover_letter import (
    CoverLetterItem,
    InvalidCoverLetterError,
    parse_cover_letter_items,
)
from app.common.session import (
    GROUP_MAX_SEQ,
    GROUP_PERSONAL_QUESTION_COUNT,
    MIN_SEQ,
    QUESTION_COUNT,
    InterviewMode,
    Persona,
)

log = logging.getLogger(__name__)


class JobType(StrEnum):
    PLAN = "PLAN"
    EXTRACT_CLAIMS = "EXTRACT_CLAIMS"
    SCORE_ANSWER = "SCORE_ANSWER"
    EVALUATE = "EVALUATE"
    MERGE_RECORDING = "MERGE_RECORDING"


class ClaimType(StrEnum):
    """자소서 주장 종류(AI 명세 2장)."""

    EXPERIENCE = "EXPERIENCE"
    NUMBER = "NUMBER"


class InvalidJobError(ValueError):
    """작업 메시지 형식이 틀렸다."""


@dataclass(frozen=True)
class Claim:
    id: str
    text: str
    type: ClaimType
    sentence_no: int
    # 주장에 드러난 인재상 기준 이름 0~2개(AI 명세 2장 talentCriteria)
    talent_criteria: tuple[str, ...] = ()


@dataclass(frozen=True)
class AskedQuestion:
    """같은 지원서·같은 면접관의 면접에서 이미 출제한 보관함 질문(AI 명세 2장 askedQuestions)."""

    content: str
    claim_id: str


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
    # 다시보기 타임라인 입력(AI 명세 4장). 채팅이거나 이전 BE 메시지면 None이다
    timeline: TimelineInput | None = None
    # STT가 끊겨 인식하지 못한 구간(AI 명세 4장 sttGaps).
    # 끊긴 적이 없거나 이전 BE 메시지면 비어 있다
    stt_gaps: tuple[SttGap, ...] = ()


@dataclass(frozen=True, kw_only=True)
class BaseJob:
    """모든 작업의 공통 필드. 작업 대상(면접 또는 지원서)의 id는 하위 클래스가 정한다."""

    job_type: ClassVar[JobType]
    # 추적용이라 로그에 BE Outbox의 id와 같은 문자열로 남도록 수신한 값을 그대로 둔다
    job_id: str
    # BE가 작업을 요청한 시각.
    # BE 최대 대기 시간의 시작이므로 AI도 이 시각부터 마감을 계산한다(AI 명세 1.3)
    requested_at: datetime

    @property
    def target(self) -> str:
        """로그에 남길 작업 대상(sessionId=55 등)."""
        raise NotImplementedError


@dataclass(frozen=True, kw_only=True)
class Job(BaseJob):
    """면접 단위 작업."""

    session_id: int

    @property
    def target(self) -> str:
        return f"sessionId={self.session_id}"


@dataclass(frozen=True, kw_only=True)
class ExtractClaimsJob(BaseJob):
    """지원서 주장 추출 작업(AI 명세 2장 STEP 01)."""

    job_type: ClassVar[JobType] = JobType.EXTRACT_CLAIMS
    application_id: int
    company_name: str
    job_title: str
    # 자기소개서 문항(1~5개). 문항 순서대로다
    cover_letter_items: tuple[CoverLetterItem, ...]

    @property
    def target(self) -> str:
        return f"applicationId={self.application_id}"


@dataclass(frozen=True, kw_only=True)
class PlanJob(Job):
    job_type: ClassVar[JobType] = JobType.PLAN
    company_name: str
    job_title: str
    # 자기소개서 문항(1~5개). 문항 순서대로다
    cover_letter_items: tuple[CoverLetterItem, ...]
    persona: Persona = Persona.COFFEE_CHAT
    # 지원 회사의 회사 카드(AI 명세 8장). 파이프라인 카드 JSON을 그대로 두고, 없으면 None이다
    company_card: Mapping[str, Any] | None = None
    # 개인 면접은 지원서에 저장된 주장(AI 명세 2장 STEP 01)을 수신한다.
    # 그룹 면접이나 이 필드를 추가하기 전에 BE가 전송한 작업은 None이고, 질문 생성이 주장을 추출한다
    claims: tuple[Claim, ...] | None = None
    # 이미 출제한 질문. 이 질문과 같은 질문은 생성하지 않는다(AI 명세 2장).
    # 없거나 그룹 면접이면 비어 있다
    asked_questions: tuple[AskedQuestion, ...] = ()
    # 생성할 질문 수(AI 명세 2장 questionCount).
    # 그룹 면접의 개인 맞춤 질문이면 2, 개인 면접은 필드가 없어 5다
    question_count: int = QUESTION_COUNT


@dataclass(frozen=True, kw_only=True)
class ScoreAnswerJob(Job):
    job_type: ClassVar[JobType] = JobType.SCORE_ANSWER
    answer_id: int
    mode: InterviewMode
    persona: Persona = Persona.COFFEE_CHAT
    seq: int
    question: str
    criteria: str
    content: str
    # 채팅 답변과 STT 토큰이 없는 화상 답변은 None이다
    tokens: tuple[SpeechToken, ...] | None
    # 채팅 답변과 음성 지표를 계산하지 못한 화상 답변은 None이다
    speech: VoiceMetrics | None
    # STT가 끊겨 인식하지 못한 구간(AI 명세 3장 sttGaps).
    # 끊긴 적이 없거나 이전 BE 메시지면 비어 있다
    stt_gaps: tuple[SttGap, ...] = ()


@dataclass(frozen=True, kw_only=True)
class EvaluateJob(Job):
    job_type: ClassVar[JobType] = JobType.EVALUATE
    mode: InterviewMode
    persona: Persona = Persona.COFFEE_CHAT
    cover_letter_items: tuple[CoverLetterItem, ...]
    claims: tuple[Claim, ...]
    answers: tuple[EvaluateAnswer, ...]
    # 같은 날 앞서 끝난 면접들의 summary(AI 명세 4장). 이전 BE 메시지에는 없다
    earlier_summaries: tuple[str, ...] = ()
    # 면접을 만들 때 정한 회사 카드(AI 명세 8장). 카드가 없으면 None이다
    company_card: Mapping[str, Any] | None = None


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
    """채점·결과 생성 작업의 질문 번호. 개인 면접은 1~5, 그룹 면접은 1~6이다(AI 명세 1.3·6.7).

    작업 메시지에 개인·그룹 면접을 구분하는 필드가 없으므로 두 면접 모두 1~6을 받는다.
    """
    value = _int(data, "seq", path)
    if not MIN_SEQ <= value <= GROUP_MAX_SEQ:
        raise InvalidJobError(f"{path}seq는 {MIN_SEQ}~{GROUP_MAX_SEQ} 사이여야 한다")
    return value


def _text(data: Mapping[str, Any], key: str, path: str = "") -> str:
    value = data.get(key)
    # 공백뿐인 글은 사용할 내용이 없으므로 빈 값과 같이 처리한다.
    # 공백 기준은 BE @NotBlank와 일치시킨다.
    # 더 넓은 str.strip을 사용하면 BE가 저장한 NBSP 답변 하나 때문에 결과 생성 작업 전체가 폐기된다
    if not isinstance(value, str) or is_java_blank(value):
        raise InvalidJobError(f"{path}{key}는 비어 있지 않은 문자열이어야 한다")
    return value


def _cover_letter_items(data: Mapping[str, Any]) -> tuple[CoverLetterItem, ...]:
    try:
        return parse_cover_letter_items(data.get("coverLetterItems"), data.get("coverLetter"))
    except InvalidCoverLetterError as e:
        raise InvalidJobError(str(e)) from e


def _mode(data: Mapping[str, Any]) -> InterviewMode:
    try:
        return InterviewMode(str(data.get("mode")))
    except ValueError as e:
        raise InvalidJobError("mode는 VIDEO 또는 CHAT이어야 한다") from e


def _persona(data: Mapping[str, Any]) -> Persona:
    # 필드를 추가하기 전에 BE가 전송한 작업은 persona가 없으므로,
    # 개발자 면접관으로 처리한다(AI 명세 1.3)
    value = data.get("persona")
    if value is None:
        return Persona.COFFEE_CHAT
    try:
        return Persona(str(value))
    except ValueError as e:
        raise InvalidJobError(f"persona는 {', '.join(Persona)} 중 하나여야 한다") from e


def _company_card(data: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """회사를 찾지 못했거나 카드가 없으면 필드가 없다(AI 명세 8장). 카드 내용은 해석하지 않는다."""
    value = data.get("companyCard")
    if value is None:
        return None
    return _object(value, "companyCard")


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


# AI 명세 6.6 impressions.items의 인상 6항목
_IMPRESSION_KEYS = ("stability", "confidence", "expression", "emotion", "likeability", "trust")


def _number(value: object) -> float:
    # bool은 int의 하위 형식이므로 형식을 정확히 비교한다
    if not (type(value) is int or type(value) is float) or not math.isfinite(value):
        raise ValueError("유한한 숫자가 아니다")
    return float(value)


def _impression_sample(value: object) -> ImpressionSample:
    if not isinstance(value, Mapping):
        raise ValueError("items가 JSON 객체가 아니다")
    at_ms = value.get("atMs")
    if type(at_ms) is not int or at_ms < 0:
        raise ValueError("atMs가 0 이상의 정수가 아니다")
    scores = {
        key: None if value.get(key) is None else _number(value.get(key)) for key in _IMPRESSION_KEYS
    }
    return ImpressionSample(at_ms=at_ms, face=_number(value.get("face")), scores=scores)


def _timeline(data: Mapping[str, Any], path: str = "") -> TimelineInput | None:
    """다시보기 타임라인 입력. 형식이 틀리면 None으로 보고 결과 생성은 계속한다.

    타임라인은 저장만 하는 부가 결과라 결과 생성 전체를 실패시키지 않는다(AI 명세 4장).
    """
    value = data.get("timeline")
    if value is None:
        return None
    try:
        timeline = _object(value, f"{path}timeline")
        times = timeline.get("trailingOffAtMs")
        if times is not None and (
            not isinstance(times, list) or any(type(ms) is not int or ms < 0 for ms in times)
        ):
            raise ValueError("trailingOffAtMs가 0 이상의 정수 목록이 아니다")
        impressions = timeline.get("impressions")
        items = None
        if impressions is not None:
            raw = _object(impressions, f"{path}timeline.impressions").get("items")
            if not isinstance(raw, list):
                raise ValueError("impressions.items가 목록이 아니다")
            items = tuple(_impression_sample(item) for item in raw)
        return TimelineInput(
            trailing_off_at_ms=None if times is None else tuple(times), impressions=items
        )
    except ValueError as e:
        log.warning("%stimeline 형식이 틀려 타임라인 없이 진행한다: %s", path, e)
        return None


def _stt_gaps(data: Mapping[str, Any], path: str = "") -> tuple[SttGap, ...]:
    """STT가 끊겨 인식하지 못한 구간(AI 명세 3·4장 sttGaps).

    없거나 형식이 틀리면 빈 목록이다.
    끊긴 구간은 채점을 보정하는 데만 사용하므로, 형식이 틀려도 채점·결과 생성을 실패시키지 않는다.
    """
    value = data.get("sttGaps")
    if value is None:
        return ()
    try:
        if not isinstance(value, list):
            raise ValueError("목록이 아니다")
        gaps = []
        for item in value:
            if not isinstance(item, Mapping):
                raise ValueError("구간이 JSON 객체가 아니다")
            start, end = item.get("startMs"), item.get("endMs")
            # bool은 int의 하위 형식이므로 형식을 정확히 비교한다
            if type(start) is not int or type(end) is not int or not 0 <= start <= end:
                raise ValueError("startMs·endMs가 0 ≤ startMs ≤ endMs인 정수가 아니다")
            gaps.append(SttGap(start, end))
        return tuple(gaps)
    except ValueError as e:
        log.warning("%ssttGaps 형식이 틀려 끊긴 구간 없이 진행한다: %s", path, e)
        return ()


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
                talent_criteria=_talent_criteria(claim, path),
            )
        )
    # 질문이 claimId로 주장을 가리키므로(AI 명세 2장) 같은 id가 두 번 있으면 대조 대상이 모호하다
    if len({claim.id for claim in claims}) != len(claims):
        raise InvalidJobError("claims의 id가 중복된다")
    return tuple(claims)


def _talent_criteria(claim: Mapping[str, Any], path: str) -> tuple[str, ...]:
    """주장의 인재상 기준 이름(AI 명세 2장 talentCriteria). 없으면(이전 주장) 빈 값이다.

    기준 이름이 12개 목록에 있는지는 검사하지 않는다.
    목록에 없는 이름은 면접관 기준과 겹치지 않을 뿐이므로 작업 전체를 형식 오류로 처리하지 않는다.
    """
    value = claim.get("talentCriteria")
    if value is None:
        return ()
    if not isinstance(value, list) or not all(
        isinstance(name, str) and not is_java_blank(name) for name in value
    ):
        raise InvalidJobError(f"{path}talentCriteria는 기준 이름 목록이어야 한다")
    return tuple(value)


def _stored_claims(data: Mapping[str, Any]) -> tuple[Claim, ...] | None:
    """개인 면접의 질문 생성이 수신하는 지원서 주장(AI 명세 2장). 없으면 None이다.

    주장이 없는 목록으로는 질문을 생성할 수 없으므로 형식 오류로 처리한다.
    """
    if data.get("claims") is None:
        return None
    claims = _claims(data)
    if not claims:
        raise InvalidJobError("claims는 1개 이상이어야 한다")
    return claims


def _asked_questions(data: Mapping[str, Any]) -> tuple[AskedQuestion, ...]:
    if data.get("askedQuestions") is None:
        return ()
    asked = []
    for i, item in enumerate(_list(data, "askedQuestions")):
        path = f"askedQuestions[{i}]."
        question = _object(item, f"askedQuestions[{i}]")
        asked.append(
            AskedQuestion(_text(question, "content", path), _text(question, "claimId", path))
        )
    return tuple(asked)


def _question_count(data: Mapping[str, Any]) -> int:
    """생성할 질문 수(AI 명세 2장 questionCount). 개인 면접은 필드가 없어 5개다.

    2·5 밖의 값은 질문을 몇 개 생성할지 알 수 없으므로 형식 오류다.
    """
    if data.get("questionCount") is None:
        return QUESTION_COUNT
    value = _int(data, "questionCount", "")
    if value not in (QUESTION_COUNT, GROUP_PERSONAL_QUESTION_COUNT):
        raise InvalidJobError(
            f"questionCount는 {GROUP_PERSONAL_QUESTION_COUNT} 또는 {QUESTION_COUNT}이어야 한다"
        )
    return value


def _earlier_summaries(data: Mapping[str, Any]) -> tuple[str, ...]:
    """없으면(이전 BE 메시지) 빈 목록이다. 빈 글은 반영할 내용이 없으므로 뺀다."""
    if data.get("earlierSummaries") is None:
        return ()
    items = _list(data, "earlierSummaries")
    if not all(isinstance(item, str) for item in items):
        raise InvalidJobError("earlierSummaries는 문자열 목록이어야 한다")
    return tuple(item for item in items if not is_java_blank(item))


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
                timeline=_timeline(answer, path),
                stt_gaps=_stt_gaps(answer, path),
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
    """모든 작업에 있는 공통 필드(AI 명세 1.3).

    주장 추출 작업은 session_id 대신 application_id가 있고, 그 밖의 작업은 session_id만 있다.
    """

    job_type: JobType
    job_id: str
    session_id: int | None = None
    application_id: int | None = None


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
    job_id = _job_id(data)
    if job_type is JobType.EXTRACT_CLAIMS:
        return JobHeader(job_type, job_id, application_id=_positive_id(data, "applicationId"))
    return JobHeader(job_type, job_id, session_id=_positive_id(data, "sessionId"))


def job_header(raw: str | bytes | Mapping[str, Any]) -> JobHeader | None:
    """형식이 틀린 작업에서 공통 필드만 해석한다.

    공통 필드도 틀리면 None을 반환한다.
    공통 필드를 읽을 수 있으면 실패 결과를 그 작업 앞으로 전송할 수 있다(AI 명세 1.3).
    """
    try:
        return _header(_load(raw))
    except InvalidJobError:
        return None


def parse_job(raw: str | bytes | Mapping[str, Any]) -> BaseJob:
    data = _load(raw)
    header = _header(data)
    job_type, job_id = header.job_type, header.job_id
    requested_at = _timestamp(data, "requestedAt")
    if job_type is JobType.EXTRACT_CLAIMS:
        return ExtractClaimsJob(
            job_id=job_id,
            application_id=_positive_id(data, "applicationId"),
            requested_at=requested_at,
            company_name=_text(data, "companyName"),
            job_title=_text(data, "jobTitle"),
            cover_letter_items=_cover_letter_items(data),
        )
    session_id = _positive_id(data, "sessionId")
    match job_type:
        case JobType.PLAN:
            return PlanJob(
                job_id=job_id,
                session_id=session_id,
                requested_at=requested_at,
                company_name=_text(data, "companyName"),
                job_title=_text(data, "jobTitle"),
                cover_letter_items=_cover_letter_items(data),
                persona=_persona(data),
                company_card=_company_card(data),
                claims=_stored_claims(data),
                asked_questions=_asked_questions(data),
                question_count=_question_count(data),
            )
        case JobType.SCORE_ANSWER:
            return ScoreAnswerJob(
                job_id=job_id,
                session_id=session_id,
                requested_at=requested_at,
                answer_id=_positive_id(data, "answerId"),
                mode=_mode(data),
                persona=_persona(data),
                seq=_seq(data),
                question=_text(data, "question"),
                criteria=_text(data, "criteria"),
                content=_text(data, "content"),
                tokens=_tokens(data),
                speech=_speech(data),
                stt_gaps=_stt_gaps(data),
            )
        case JobType.EVALUATE:
            return EvaluateJob(
                job_id=job_id,
                session_id=session_id,
                requested_at=requested_at,
                mode=_mode(data),
                persona=_persona(data),
                cover_letter_items=_cover_letter_items(data),
                claims=_claims(data),
                answers=_evaluate_answers(data),
                earlier_summaries=_earlier_summaries(data),
                company_card=_company_card(data),
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
