import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from app.common.answer import (
    ImpressionSample,
    SpeechToken,
    TimelineInput,
    VoiceMetrics,
    is_java_blank,
)
from app.common.cover_letter import CoverLetterItem
from app.common.session import InterviewMode, Persona
from app.worker.messages import (
    Claim,
    ClaimType,
    EvaluateAnswer,
    EvaluateJob,
    InvalidJobError,
    JobHeader,
    JobType,
    MergeRecordingJob,
    PlanJob,
    ScoreAnswerJob,
    job_header,
    parse_job,
)

JOB_ID = "8f0c2a4e-1b3d-4c5f-9a7e-6d8b0c1e2f3a"
REQUESTED_AT = datetime(2026, 10, 22, 14, 3, 13, tzinfo=timezone(timedelta(hours=9)))
TOKENS = [
    {"text": "조회", "startMs": 0, "endMs": 280},
    {"text": " 쿼리", "startMs": 300, "endMs": 520},
]
SPEECH = {"trailingOffRatio": 12.5, "pitchRangeSt": 6.2}
EVALUATION = {"criteria": {"JOB_FIT": {"level": 3, "score": 86, "reason": "근거"}}}


def plan(**overrides: Any) -> dict[str, Any]:
    data = {
        "jobType": "PLAN",
        "jobId": JOB_ID,
        "sessionId": 55,
        "requestedAt": "2026-10-22T14:03:13+09:00",
        "companyName": "한끗전자",
        "jobTitle": "백엔드 개발",
        "coverLetterItems": [
            {"question": "지원 동기", "answer": "조회 응답 시간을 40% 줄였습니다."}
        ],
    }
    return _apply(data, overrides)


def score(**overrides: Any) -> dict[str, Any]:
    """AI 명세 1.3 예시와 같은 SCORE_ANSWER 작업 메시지."""
    data = {
        "jobType": "SCORE_ANSWER",
        "jobId": JOB_ID,
        "sessionId": 55,
        "requestedAt": "2026-10-22T14:03:13+09:00",
        "answerId": 903,
        "mode": "VIDEO",
        "persona": "DEVIL",
        "seq": 3,
        "question": "응답 시간을 40% 줄인 과정은?",
        "criteria": "원인 분석 · 수치 근거",
        "content": "조회 쿼리 실행 계획을 보고…",
        "tokens": TOKENS,
        "speech": SPEECH,
    }
    return _apply(data, overrides)


def answer(**overrides: Any) -> dict[str, Any]:
    data = {
        "answerId": 903,
        "seq": 1,
        "question": "응답 시간을 40% 줄인 과정은?",
        "criteria": "원인 분석 · 수치 근거",
        "content": "조회 쿼리 실행 계획을 보고…",
        "tokens": TOKENS,
        "evaluation": None,
    }
    return _apply(data, overrides)


def claim(**overrides: Any) -> dict[str, Any]:
    data = {"id": "c1", "text": "조회 응답 시간을 40% 줄였다", "type": "NUMBER", "sentenceNo": 4}
    return _apply(data, overrides)


def evaluate(**overrides: Any) -> dict[str, Any]:
    data = {
        "jobType": "EVALUATE",
        "jobId": JOB_ID,
        "sessionId": 55,
        "requestedAt": "2026-10-22T14:03:13+09:00",
        "mode": "CHAT",
        "coverLetterItems": [
            {"question": "지원 동기", "answer": "조회 응답 시간을 40% 줄였습니다."}
        ],
        "claims": [claim()],
        "answers": [answer()],
    }
    return _apply(data, overrides)


def merge(**overrides: Any) -> dict[str, Any]:
    data = {
        "jobType": "MERGE_RECORDING",
        "jobId": JOB_ID,
        "sessionId": 55,
        "requestedAt": "2026-10-22T14:03:13+09:00",
        "rawPrefix": "recordings/raw/55/",
        "objectKey": "recordings/55.mp4",
    }
    return _apply(data, overrides)


def _apply(data: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    # ...는 그 필드를 생략한 메시지를 뜻한다
    merged = {**data, **overrides}
    return {k: v for k, v in merged.items() if v is not ...}


def test_parses_plan_job() -> None:
    assert parse_job(json.dumps(plan())) == PlanJob(
        job_id=JOB_ID,
        session_id=55,
        requested_at=REQUESTED_AT,
        company_name="한끗전자",
        job_title="백엔드 개발",
        cover_letter_items=(CoverLetterItem("지원 동기", "조회 응답 시간을 40% 줄였습니다."),),
    )


def test_parses_score_answer_job_from_spec_example() -> None:
    assert parse_job(json.dumps(score())) == ScoreAnswerJob(
        job_id=JOB_ID,
        session_id=55,
        requested_at=REQUESTED_AT,
        answer_id=903,
        mode=InterviewMode.VIDEO,
        persona=Persona.DEVIL,
        seq=3,
        question="응답 시간을 40% 줄인 과정은?",
        criteria="원인 분석 · 수치 근거",
        content="조회 쿼리 실행 계획을 보고…",
        tokens=(SpeechToken("조회", 0, 280), SpeechToken(" 쿼리", 300, 520)),
        speech=VoiceMetrics(trailing_off_ratio=12.5, pitch_range_st=6.2),
    )


@pytest.mark.parametrize("tokens", [..., None])
def test_chat_answer_without_tokens_is_valid(tokens: Any) -> None:
    """채팅 답변은 tokens가 없다(AI 명세 3장 「tokens(화상)」)."""
    job = parse_job(score(mode="CHAT", tokens=tokens))

    assert isinstance(job, ScoreAnswerJob)
    assert job.mode is InterviewMode.CHAT
    assert job.tokens is None


def test_parses_evaluate_job() -> None:
    scored = answer(answerId=904, seq=2, tokens=None, evaluation=EVALUATION)

    job = parse_job(evaluate(answers=[answer(), scored]))

    assert job == EvaluateJob(
        job_id=JOB_ID,
        session_id=55,
        requested_at=REQUESTED_AT,
        mode=InterviewMode.CHAT,
        cover_letter_items=(CoverLetterItem("지원 동기", "조회 응답 시간을 40% 줄였습니다."),),
        claims=(Claim("c1", "조회 응답 시간을 40% 줄였다", ClaimType.NUMBER, 4),),
        answers=(
            EvaluateAnswer(
                answer_id=903,
                seq=1,
                question="응답 시간을 40% 줄인 과정은?",
                criteria="원인 분석 · 수치 근거",
                content="조회 쿼리 실행 계획을 보고…",
                tokens=(SpeechToken("조회", 0, 280), SpeechToken(" 쿼리", 300, 520)),
                speech=None,
                evaluation=None,
            ),
            EvaluateAnswer(
                answer_id=904,
                seq=2,
                question="응답 시간을 40% 줄인 과정은?",
                criteria="원인 분석 · 수치 근거",
                content="조회 쿼리 실행 계획을 보고…",
                tokens=None,
                speech=None,
                evaluation=EVALUATION,
            ),
        ),
    )


def test_missing_evaluation_is_same_as_null() -> None:
    job = parse_job(evaluate(answers=[answer(evaluation=...)]))

    assert isinstance(job, EvaluateJob)
    assert job.answers[0].evaluation is None


def test_parses_merge_recording_job() -> None:
    assert parse_job(merge()) == MergeRecordingJob(
        job_id=JOB_ID,
        session_id=55,
        requested_at=REQUESTED_AT,
        raw_prefix="recordings/raw/55/",
        object_key="recordings/55.mp4",
    )


@pytest.mark.parametrize("message", [plan(), score(), evaluate(), merge()])
def test_job_type_matches_message(message: dict[str, Any]) -> None:
    assert parse_job(message).job_type is JobType(message["jobType"])


def test_ignores_fields_not_in_spec() -> None:
    """고도화에서 추가될 회사 공시 요약처럼 명세에 없는 필드가 있어도 처리한다."""
    assert parse_job(plan(companySummary={"summary": "…"})) == parse_job(plan())


def test_parses_bytes() -> None:
    assert parse_job(json.dumps(plan()).encode()) == parse_job(plan())


def test_keeps_job_id_as_received() -> None:
    upper = JOB_ID.upper()

    assert parse_job(plan(jobId=upper)).job_id == upper


def test_deeply_nested_json_is_invalid() -> None:
    """해석 중 RecursionError가 발생해도 작업자를 종료시키지 않고 형식 오류로 처리한다."""
    depth = 100_000

    with pytest.raises(InvalidJobError):
        parse_job("[" * depth + "]" * depth)


@pytest.mark.parametrize("raw", ["{", "[1]", "null"])
def test_non_object_json_is_invalid(raw: str) -> None:
    with pytest.raises(InvalidJobError):
        parse_job(raw)


@pytest.mark.parametrize("job_type", ["SCORE", "score_answer", None])
def test_unknown_job_type_is_invalid(job_type: Any) -> None:
    with pytest.raises(InvalidJobError, match="jobType"):
        parse_job(plan(jobType=job_type))


@pytest.mark.parametrize("job_id", ["", "  ", "8f0c", "8f0c2a4e-1b3d-4c5f-9a7e", 7, None])
def test_non_uuid_job_id_is_invalid(job_id: Any) -> None:
    with pytest.raises(InvalidJobError, match="jobId"):
        parse_job(plan(jobId=job_id))


@pytest.mark.parametrize("value", [0, -1, "55", 55.0, True, None])
def test_invalid_session_id_is_invalid(value: Any) -> None:
    with pytest.raises(InvalidJobError, match="sessionId"):
        parse_job(plan(sessionId=value))


def test_session_id_one_is_valid() -> None:
    assert parse_job(plan(sessionId=1)).session_id == 1


@pytest.mark.parametrize(
    ("factory", "key"),
    [
        (plan, "companyName"),
        (plan, "jobTitle"),
        (plan, "coverLetterItems"),
        (score, "answerId"),
        (score, "mode"),
        (score, "seq"),
        (score, "question"),
        (score, "criteria"),
        (score, "content"),
        (evaluate, "mode"),
        (evaluate, "coverLetterItems"),
        (evaluate, "claims"),
        (evaluate, "answers"),
        (merge, "rawPrefix"),
        (merge, "objectKey"),
    ],
)
def test_missing_required_field_is_invalid(factory: Any, key: str) -> None:
    """AI가 DB를 읽지 않으므로 작업에 필요한 내용이 누락된 메시지는 처리할 수 없다."""
    with pytest.raises(InvalidJobError, match=key):
        parse_job(factory(**{key: ...}))


@pytest.mark.parametrize("value", ["", "   ", " \t\r\n", "\u3000\u3000", "\u2028", 7, None])
@pytest.mark.parametrize(
    ("factory", "key"),
    [(score, "question"), (score, "criteria"), (score, "content")],
)
def test_blank_or_non_string_text_is_invalid(factory: Any, key: str, value: Any) -> None:
    """BE @NotBlank(Java String.isBlank)가 거부하는 공백은 AI도 빈 값으로 처리한다."""
    with pytest.raises(InvalidJobError, match=key):
        parse_job(factory(**{key: value}))


@pytest.mark.parametrize("value", ["", "   ", " \t\r\n", "\u3000\u3000", "\u2028", 7, None])
@pytest.mark.parametrize("field", ["question", "answer"])
@pytest.mark.parametrize("factory", [plan, evaluate])
def test_blank_cover_letter_item_text_is_invalid(factory: Any, field: str, value: Any) -> None:
    """문항 질문 · 답변도 BE @NotBlank와 같은 공백 기준으로 빈 값을 거부한다."""
    item = {"question": "지원 동기", "answer": "저는…", field: value}
    with pytest.raises(InvalidJobError, match=rf"coverLetterItems\[1\]\.{field}"):
        parse_job(factory(coverLetterItems=[{"question": "문항", "answer": "답변"}, item]))


@pytest.mark.parametrize(
    "value",
    [[], [{"question": "문항", "answer": "답변"}] * 6, "자소서", [["문항", "답변"]], None],
)
@pytest.mark.parametrize("factory", [plan, evaluate])
def test_cover_letter_items_must_be_one_to_five_objects(factory: Any, value: Any) -> None:
    """API 명세 4.1: 문항은 1~5개 객체다."""
    with pytest.raises(InvalidJobError, match="coverLetterItems"):
        parse_job(factory(coverLetterItems=value))


def test_cover_letter_items_keep_order() -> None:
    job = parse_job(
        plan(
            coverLetterItems=[
                {"question": "지원 동기", "answer": "첫째"},
                {"question": "협업 경험", "answer": "둘째"},
            ]
        )
    )

    assert isinstance(job, PlanJob)
    assert job.cover_letter_items == (
        CoverLetterItem("지원 동기", "첫째"),
        CoverLetterItem("협업 경험", "둘째"),
    )


@pytest.mark.parametrize("factory", [plan, evaluate])
def test_legacy_cover_letter_becomes_first_item(factory: Any) -> None:
    """AI 명세 1.3: 이전 BE의 coverLetter(글 하나)는 질문 '자기소개서'인 1번 문항으로 읽는다."""
    job = parse_job(factory(coverLetterItems=..., coverLetter="저는 조회 응답 시간을 줄였습니다."))

    assert isinstance(job, (PlanJob, EvaluateJob))
    assert job.cover_letter_items == (
        CoverLetterItem("자기소개서", "저는 조회 응답 시간을 줄였습니다."),
    )


@pytest.mark.parametrize("legacy", ["  ", 7])
@pytest.mark.parametrize("factory", [plan, evaluate])
def test_blank_or_non_string_legacy_cover_letter_is_invalid(factory: Any, legacy: Any) -> None:
    with pytest.raises(InvalidJobError, match="coverLetterItems"):
        parse_job(factory(coverLetterItems=..., coverLetter=legacy))


@pytest.mark.parametrize("factory", [plan, evaluate])
def test_cover_letter_items_win_over_legacy_cover_letter(factory: Any) -> None:
    job = parse_job(factory(coverLetter="이전 글"))

    assert isinstance(job, (PlanJob, EvaluateJob))
    assert job.cover_letter_items == (
        CoverLetterItem("지원 동기", "조회 응답 시간을 40% 줄였습니다."),
    )


# OpenJDK 21에서 Character.isWhitespace가 참인 코드 포인트 전체(25자)다.
# 구현의 판정식과 별도로 기록해 두어야 판정식이 변경될 때 BE와 어긋나는지 검사할 수 있다
JAVA_WHITESPACE = (
    "\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f"
    "\u0020\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2008\u2009\u200a"
    "\u2028\u2029\u205f\u3000"
)


def test_java_whitespace_list_has_25_code_points() -> None:
    assert len(set(JAVA_WHITESPACE)) == 25


@pytest.mark.parametrize("char", list(JAVA_WHITESPACE), ids=lambda char: f"U+{ord(char):04X}")
def test_java_whitespace_only_text_is_invalid(char: str) -> None:
    with pytest.raises(InvalidJobError, match="content"):
        parse_job(score(content=char * 2))


def test_other_code_points_are_not_whitespace() -> None:
    """Java가 공백으로 보지 않는 글자를 공백으로 판정하면 BE가 저장한 답변을 AI가 폐기한다."""
    expected = set(JAVA_WHITESPACE)
    wrong = [
        f"U+{code:04X}"
        for code in range(sys.maxunicode + 1)
        if chr(code) not in expected and is_java_blank(chr(code))
    ]

    assert wrong == []


@pytest.mark.parametrize("value", ["\u00a0", "\u00a0\u202f", "\u2007", "\x85"])
def test_text_blank_only_outside_java_whitespace_is_kept(value: str) -> None:
    """BE @NotBlank는 NBSP 등을 공백으로 보지 않아 저장하므로, AI가 작업을 폐기하지 않는다."""
    job = parse_job(score(content=value))

    assert isinstance(job, ScoreAnswerJob)
    assert job.content == value


@pytest.mark.parametrize("mode", ["video", "AUDIO", None])
def test_unknown_mode_is_invalid(mode: Any) -> None:
    with pytest.raises(InvalidJobError, match="mode"):
        parse_job(score(mode=mode))


# 기준: AI 명세 1.3 persona(없으면 COFFEE_CHAT, 두 값이 아니면 형식이 틀린 작업)
@pytest.mark.parametrize("factory", [plan, score, evaluate])
@pytest.mark.parametrize("persona", ["DEVIL", "COFFEE_CHAT"])
def test_reads_persona(factory: Any, persona: str) -> None:
    job = parse_job(factory(persona=persona))

    assert isinstance(job, PlanJob | ScoreAnswerJob | EvaluateJob)
    assert job.persona is Persona(persona)


@pytest.mark.parametrize("factory", [plan, score, evaluate])
@pytest.mark.parametrize("persona", [..., None])
def test_missing_persona_is_coffee_chat(factory: Any, persona: Any) -> None:
    job = parse_job(factory(persona=persona))

    assert isinstance(job, PlanJob | ScoreAnswerJob | EvaluateJob)
    assert job.persona is Persona.COFFEE_CHAT


@pytest.mark.parametrize("factory", [plan, score, evaluate])
@pytest.mark.parametrize("persona", ["devil", "INTERVIEWER", "", 1, True])
def test_unknown_persona_is_invalid(factory: Any, persona: Any) -> None:
    message = factory(persona=persona)

    with pytest.raises(InvalidJobError, match="persona"):
        parse_job(message)


@pytest.mark.parametrize("seq", [0, 6, "3", True])
def test_seq_outside_question_range_is_invalid(seq: Any) -> None:
    """질문은 seq 1~5로 5개다(AI 명세 2장)."""
    with pytest.raises(InvalidJobError, match="seq"):
        parse_job(score(seq=seq))


@pytest.mark.parametrize("seq", [1, 5])
def test_seq_boundaries_are_valid(seq: int) -> None:
    job = parse_job(score(seq=seq))

    assert isinstance(job, ScoreAnswerJob)
    assert job.seq == seq


@pytest.mark.parametrize("value", [0, -1, "903", True])
def test_invalid_answer_id_is_invalid(value: Any) -> None:
    with pytest.raises(InvalidJobError, match="answerId"):
        parse_job(score(answerId=value))


@pytest.mark.parametrize(
    "token",
    [
        {"text": "조회", "startMs": 300, "endMs": 299},
        {"text": "조회", "startMs": -1, "endMs": 10},
        {"text": "조회", "startMs": 0.5, "endMs": 10},
        {"text": "조회", "startMs": 0},
        {"text": "", "startMs": 0, "endMs": 10},
        {"startMs": 0, "endMs": 10},
        "조회",
    ],
)
def test_invalid_token_is_invalid(token: Any) -> None:
    with pytest.raises(InvalidJobError, match=r"tokens\[1\]"):
        parse_job(score(tokens=[TOKENS[0], token]))


def test_token_with_same_start_and_end_is_valid() -> None:
    """AI 명세 6.2는 endMs ≥ startMs이므로 길이 0인 토큰을 허용한다."""
    job = parse_job(score(tokens=[{"text": " ", "startMs": 280, "endMs": 280}]))

    assert isinstance(job, ScoreAnswerJob)
    assert job.tokens == (SpeechToken(" ", 280, 280),)


@pytest.mark.parametrize("tokens", ["조회", 7, {"text": "조회"}])
def test_tokens_must_be_array(tokens: Any) -> None:
    """배열이 아닌 값도 형식 오류로 처리해 작업이 처리 중 리스트에 계속 남지 않게 한다."""
    with pytest.raises(InvalidJobError, match="tokens"):
        parse_job(score(tokens=tokens))


def test_evaluate_without_answers_is_invalid() -> None:
    """BE는 답변이 하나 이상일 때만 결과 생성을 요청한다(AI 명세 4장)."""
    with pytest.raises(InvalidJobError, match="answers"):
        parse_job(evaluate(answers=[]))


def test_evaluate_with_empty_claims_is_valid() -> None:
    job = parse_job(evaluate(claims=[]))

    assert isinstance(job, EvaluateJob)
    assert job.claims == ()


@pytest.mark.parametrize(
    ("override", "path"),
    [
        ({"answerId": 0}, r"answers\[1\]\.answerId"),
        ({"seq": 6}, r"answers\[1\]\.seq"),
        ({"question": ""}, r"answers\[1\]\.question"),
        ({"criteria": ...}, r"answers\[1\]\.criteria"),
        ({"content": " "}, r"answers\[1\]\.content"),
        ({"tokens": [{"text": "조회", "startMs": 5, "endMs": 1}]}, r"answers\[1\]\.tokens\[0\]"),
        ({"evaluation": "채점함"}, r"answers\[1\]\.evaluation"),
        ({"evaluation": []}, r"answers\[1\]\.evaluation"),
        ({"evaluation": 3}, r"answers\[1\]\.evaluation"),
    ],
)
def test_invalid_evaluate_answer_reports_its_position(override: dict[str, Any], path: str) -> None:
    second = answer(**{"answerId": 904, "seq": 2, **override})

    with pytest.raises(InvalidJobError, match=path):
        parse_job(evaluate(answers=[answer(), second]))


def test_evaluate_answer_must_be_object() -> None:
    with pytest.raises(InvalidJobError, match=r"answers\[0\]"):
        parse_job(evaluate(answers=["답변"]))


def test_duplicate_answer_seq_is_invalid() -> None:
    """질문 하나에 답변 하나이므로 같은 seq가 두 번 오면 항목 평균이 왜곡된다."""
    with pytest.raises(InvalidJobError, match="seq"):
        parse_job(evaluate(answers=[answer(), answer(answerId=904)]))


def test_duplicate_answer_id_is_invalid() -> None:
    with pytest.raises(InvalidJobError, match="answerId"):
        parse_job(evaluate(answers=[answer(), answer(seq=2)]))


@pytest.mark.parametrize(
    ("override", "path"),
    [
        ({"id": ""}, r"claims\[0\]\.id"),
        ({"text": ...}, r"claims\[0\]\.text"),
        ({"type": "SKILL"}, r"claims\[0\]\.type"),
        ({"sentenceNo": 0}, r"claims\[0\]\.sentenceNo"),
    ],
)
def test_invalid_claim_reports_its_position(override: dict[str, Any], path: str) -> None:
    with pytest.raises(InvalidJobError, match=path):
        parse_job(evaluate(claims=[claim(**override)]))


def test_duplicate_claim_id_is_invalid() -> None:
    with pytest.raises(InvalidJobError, match="id"):
        parse_job(evaluate(claims=[claim(), claim(text="다른 주장")]))


def test_claims_must_be_array() -> None:
    with pytest.raises(InvalidJobError, match="claims"):
        parse_job(evaluate(claims={"id": "c1"}))


def test_raw_prefix_may_point_to_track_folder_below_session() -> None:
    job = parse_job(merge(rawPrefix="recordings/raw/55/egress-1/"))

    assert isinstance(job, MergeRecordingJob)
    assert job.raw_prefix == "recordings/raw/55/egress-1/"


@pytest.mark.parametrize(
    "raw_prefix", ["recordings/raw/56/", "recordings/raw/55", "recordings/raw/550/", "raw/55/"]
)
def test_raw_prefix_of_other_session_is_invalid(raw_prefix: str) -> None:
    """다른 면접의 녹화를 읽지 않도록 BE 설계 10장의 키 규칙을 확인한다."""
    with pytest.raises(InvalidJobError, match="rawPrefix"):
        parse_job(merge(rawPrefix=raw_prefix))


@pytest.mark.parametrize(
    "object_key", ["recordings/56.mp4", "recordings/55.webm", "recordings/raw/55.mp4"]
)
def test_object_key_of_other_session_is_invalid(object_key: str) -> None:
    """다른 면접의 녹화를 덮어쓰지 않도록 결과 위치를 확인한다."""
    with pytest.raises(InvalidJobError, match="objectKey"):
        parse_job(merge(objectKey=object_key))


@pytest.mark.parametrize("speech", [..., None])
def test_answer_without_speech_is_valid(speech: Any) -> None:
    """채팅 답변과 음성 지표를 계산하지 못한 화상 답변은 speech가 없다(AI 명세 3장)."""
    job = parse_job(score(speech=speech))

    assert isinstance(job, ScoreAnswerJob)
    assert job.speech is None


def test_speech_values_may_be_null() -> None:
    """에이전트가 구하지 못한 지표는 null로 전송한다(AI 명세 6.2 speech)."""
    job = parse_job(score(speech={"trailingOffRatio": None, "pitchRangeSt": 3}))

    assert isinstance(job, ScoreAnswerJob)
    assert job.speech == VoiceMetrics(trailing_off_ratio=None, pitch_range_st=3.0)


@pytest.mark.parametrize(
    "speech",
    [[12.5], "12.5", {"trailingOffRatio": "12.5"}, {"pitchRangeSt": True}],
)
def test_invalid_speech_is_invalid(speech: Any) -> None:
    with pytest.raises(InvalidJobError, match="speech"):
        parse_job(score(speech=speech))


def test_evaluate_answer_speech_is_parsed() -> None:
    """결과 생성이 다시 채점할 때 에이전트가 계산한 값을 사용한다(AI 명세 4장 입력)."""
    job = parse_job(evaluate(answers=[answer(speech=SPEECH)]))

    assert isinstance(job, EvaluateJob)
    assert job.answers[0].speech == VoiceMetrics(trailing_off_ratio=12.5, pitch_range_st=6.2)


TIMELINE = {
    "trailingOffAtMs": [9120],
    "impressions": {
        "promptVersion": "impression-v1",
        "modelVersion": "jev-1.14.0",
        "items": [
            {
                "atMs": 1500,
                "face": 0.98,
                "stability": 62.5,
                "confidence": 70.1,
                "expression": 55,
                "emotion": None,
                "likeability": 66.0,
                "trust": 71.2,
            }
        ],
    },
}


def test_evaluate_answer_timeline_is_parsed() -> None:
    """다시보기 타임라인 입력(AI 명세 4장)."""
    job = parse_job(evaluate(answers=[answer(timeline=TIMELINE)]))

    assert isinstance(job, EvaluateJob)
    assert job.answers[0].timeline == TimelineInput(
        trailing_off_at_ms=(9120,),
        impressions=(
            ImpressionSample(
                at_ms=1500,
                face=0.98,
                scores={
                    "stability": 62.5,
                    "confidence": 70.1,
                    "expression": 55.0,
                    "emotion": None,
                    "likeability": 66.0,
                    "trust": 71.2,
                },
            ),
        ),
    )


@pytest.mark.parametrize("timeline", [..., None])
def test_answer_without_timeline_is_valid(timeline: Any) -> None:
    job = parse_job(evaluate(answers=[answer(timeline=timeline)]))

    assert isinstance(job, EvaluateJob)
    assert job.answers[0].timeline is None


@pytest.mark.parametrize(
    "timeline",
    [
        "x",
        {"trailingOffAtMs": [-1]},
        {"trailingOffAtMs": [True]},
        {"impressions": {"items": "x"}},
        {"impressions": {"items": [{"atMs": "1", "face": 0.9}]}},
        {"impressions": {"items": [{"atMs": 1, "face": None}]}},
        {"impressions": {"items": [{"atMs": 1, "face": 0.9, "trust": "70"}]}},
    ],
)
def test_broken_timeline_is_ignored_and_job_continues(
    timeline: Any, caplog: pytest.LogCaptureFixture
) -> None:
    """타임라인은 부가 결과라 형식이 틀려도 결과 생성을 실패시키지 않는다(AI 명세 4장)."""
    job = parse_job(evaluate(answers=[answer(timeline=timeline)]))

    assert isinstance(job, EvaluateJob)
    assert job.answers[0].timeline is None
    assert "timeline 형식이 틀려" in caplog.text


def test_job_header_of_invalid_job_keeps_common_fields() -> None:
    """작업 내용이 틀려도 공통 필드를 읽을 수 있으면 실패 결과를 전송할 수 있다(AI 명세 1.3)."""
    raw = json.dumps(plan(companyName=...))

    with pytest.raises(InvalidJobError):
        parse_job(raw)
    assert job_header(raw) == JobHeader(JobType.PLAN, JOB_ID, 55)


@pytest.mark.parametrize(
    "raw",
    [
        "{",
        json.dumps([plan()]),
        json.dumps(plan(jobType="TRANSLATE")),
        json.dumps(plan(jobId="job-1")),
        json.dumps(plan(sessionId=0)),
    ],
)
def test_job_header_without_common_fields_is_none(raw: str) -> None:
    assert job_header(raw) is None


@pytest.mark.parametrize(
    "requested_at", [..., None, "2026-10-22 14:03", "2026-10-22T14:03:13", 1761109393]
)
def test_requested_at_must_be_iso_time_with_offset(requested_at: Any) -> None:
    """마감을 BE와 같은 시각에서 계산하므로 시간대 오프셋이 있는 시각만 받는다(AI 명세 1.3)."""
    with pytest.raises(InvalidJobError, match="requestedAt"):
        parse_job(plan(requestedAt=requested_at))


def test_requested_at_keeps_given_instant() -> None:
    job = parse_job(plan(requestedAt="2026-10-22T05:03:13Z"))

    assert job.requested_at == REQUESTED_AT


# 기준: AI 명세 4장 earlierSummaries(같은 날 앞서 끝난 면접의 summary, 없으면 빈 목록)
def test_evaluate_reads_earlier_summaries_of_the_day() -> None:
    job = parse_job(evaluate(earlierSummaries=["결론부터 말하기", " "]))
    assert isinstance(job, EvaluateJob) and job.earlier_summaries == ("결론부터 말하기",)
    old = parse_job(evaluate())
    assert isinstance(old, EvaluateJob) and old.earlier_summaries == ()
    with pytest.raises(InvalidJobError):
        parse_job(evaluate(earlierSummaries=[1]))
