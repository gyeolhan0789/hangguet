from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from app.common.gms import GmsBadOutputError, GmsUnavailableError
from app.interview.plan.claims import build_claim_messages, split_sentences
from app.interview.plan.generate import extract_claims, generate_questions
from app.interview.plan.llm import PlanFailedError, PlanOutputError
from app.interview.plan.questions import (
    Question,
    build_question_messages,
    build_regenerate_messages,
    check_question_set,
)
from app.worker.messages import Claim, ClaimType, PlanJob
from tests.interview.plan.fakes import JOB, FakeChat, question

CLAIMS = (
    Claim("c1", "주문 조회 응답 시간을 40% 줄였다", ClaimType.NUMBER, 4),
    Claim("c2", "캐시 계층을 설계했다", ClaimType.EXPERIENCE, 5),
)
GOOD_CLAIMS = {"claims": [{"text": "캐시 계층을 설계했다", "type": "EXPERIENCE", "sentenceNo": 5}]}
NO_CLAIMS: dict[str, Any] = {"claims": []}
UNSUPPORTED_CLAIMS = {
    "claims": [{"text": "응답 시간을 90% 줄였다", "type": "NUMBER", "sentenceNo": 4}]
}


# BE가 작업을 요청한 시각(AI 명세 1.3 requestedAt)
REQUESTED_AT = datetime(2026, 10, 22, 14, 3, 13, tzinfo=timezone(timedelta(hours=9)))


def five(**claim_ids: str) -> dict[str, Any]:
    """seq 1~5 질문.

    키워드 q3="c9"처럼 특정 질문의 claimId만 변경한다.
    """
    return {"questions": [question(seq, claim_ids.get(f"q{seq}", "c1")) for seq in range(1, 6)]}


def regenerated(claim_id: str = "c2", seq: Any = 9) -> dict[str, Any]:
    return {
        "question": {"seq": seq, "content": "다시 묻는다?", "criteria": "근거", "claimId": claim_id}
    }


# 주장 추출


def test_extract_returns_first_valid_output() -> None:
    chat = FakeChat([GOOD_CLAIMS])

    result = extract_claims(chat, JOB)

    assert result.claims == (Claim("c1", "캐시 계층을 설계했다", ClaimType.EXPERIENCE, 5),)
    assert result.model == "gms-served"
    assert len(chat.calls) == 1


@pytest.mark.parametrize("broken", [NO_CLAIMS, UNSUPPORTED_CLAIMS, GmsBadOutputError("JSON 아님")])
def test_extract_retries_once_after_broken_output(broken: Any) -> None:
    chat = FakeChat([broken, GOOD_CLAIMS])

    assert len(extract_claims(chat, JOB).claims) == 1
    sentences = split_sentences(JOB.cover_letter)
    assert chat.calls == [build_claim_messages(JOB, sentences)] * 2


def test_extract_fails_after_one_retry() -> None:
    """1회 재시도 뒤에도 깨져 있으면 실패하고, 세 번째 호출은 하지 않는다."""
    chat = FakeChat([NO_CLAIMS, GmsBadOutputError("JSON 아님"), GOOD_CLAIMS])

    with pytest.raises(PlanFailedError):
        extract_claims(chat, JOB)
    assert len(chat.calls) == 2


def test_extract_does_not_retry_unavailable_gms() -> None:
    """GMS 호출 계층이 이미 재시도했으므로 다시 호출하지 않고 전파한다."""
    chat = FakeChat([GmsUnavailableError("5xx"), GOOD_CLAIMS])

    with pytest.raises(GmsUnavailableError):
        extract_claims(chat, JOB)
    assert len(chat.calls) == 1


def test_extract_drops_unsupported_claim_and_renumbers() -> None:
    content = {
        "claims": [
            {"text": "응답 시간을 60% 줄였다", "type": "NUMBER", "sentenceNo": 4},
            {"text": "팀원 4명과 절차를 정리했다", "type": "EXPERIENCE", "sentenceNo": 6},
        ]
    }

    result = extract_claims(FakeChat([content]), JOB)

    assert result.claims == (Claim("c1", "팀원 4명과 절차를 정리했다", ClaimType.EXPERIENCE, 6),)


@pytest.mark.parametrize(
    "text", ["피크 시간 DB 부하를 절반으로 낮췄다", "피크 시간 DB 부하를 50% 낮췄다"]
)
def test_extract_keeps_half_claim_from_live_cover_letter(text: str) -> None:
    """실제 GMS 시험의 자소서에서 6번 문장의 「절반」 주장이 폐기되지 않는다."""
    job = PlanJob(
        job_id=JOB.job_id,
        session_id=55,
        requested_at=REQUESTED_AT,
        company_name="○○전자",
        job_title="백엔드 개발자",
        cover_letter=(
            "[지원 동기]\n"
            "대용량 트래픽을 안정적으로 처리하는 백엔드 개발자가 되고 싶어 지원했습니다.\n"
            "[프로젝트 경험]\n"
            "교내 수강신청 서비스에서 조회 API 응답이 3초 걸리는 문제가 있었습니다. "
            "실행 계획을 분석해 복합 인덱스를 추가했고 응답 시간을 40% 줄였습니다. "
            "또한 Redis 캐시를 도입해 피크 시간 DB 부하를 절반으로 낮췄습니다.\n"
            "[협업]\n"
            "4명 팀에서 코드 리뷰 규칙을 만들어 배포 오류를 줄였습니다."
        ),
    )
    content = {
        "claims": [
            {"text": "조회 응답 시간을 40% 줄였다", "type": "NUMBER", "sentenceNo": 5},
            {"text": text, "type": "NUMBER", "sentenceNo": 6},
        ]
    }

    result = extract_claims(FakeChat([content]), job)

    assert [(c.id, c.text, c.sentence_no) for c in result.claims] == [
        ("c1", "조회 응답 시간을 40% 줄였다", 5),
        ("c2", text, 6),
    ]


# 질문 수와 seq


def test_check_question_set_sorts_by_seq() -> None:
    questions = [Question(seq, "질문", "기준", "c1") for seq in (3, 1, 5, 2, 4)]

    assert [q.seq for q in check_question_set(questions)] == [1, 2, 3, 4, 5]


@pytest.mark.parametrize(
    "seqs",
    [(1, 2, 3, 4), (1, 2, 3, 4, 5, 6), (1, 1, 2, 3, 4), (0, 1, 2, 3, 4), (2, 3, 4, 5, 6), ()],
)
def test_check_question_set_rejects_count_or_seq(seqs: tuple[int, ...]) -> None:
    questions = [Question(seq, "질문", "기준", "c1") for seq in seqs]

    with pytest.raises(PlanOutputError):
        check_question_set(questions)


def test_generate_returns_five_questions_in_seq_order() -> None:
    shuffled = {"questions": [question(seq) for seq in (5, 4, 3, 2, 1)]}
    chat = FakeChat([shuffled])

    result = generate_questions(chat, JOB, CLAIMS)

    assert [q.seq for q in result.questions] == [1, 2, 3, 4, 5]
    assert result.model == "gms-served"
    assert len(chat.calls) == 1


@pytest.mark.parametrize(
    "broken",
    [
        {"questions": [question(seq) for seq in range(1, 5)]},
        {"questions": [question(seq) for seq in range(1, 7)]},
        {"questions": [question(seq) for seq in (1, 1, 2, 3, 4)]},
        {"questions": [question(1), "질문"]},
        GmsBadOutputError("JSON 아님"),
    ],
)
def test_generate_retries_once_when_not_five_or_not_json(broken: Any) -> None:
    chat = FakeChat([broken, five()])

    assert len(generate_questions(chat, JOB, CLAIMS).questions) == 5
    assert chat.calls == [build_question_messages(JOB, CLAIMS)] * 2


def test_generate_fails_when_still_not_five_after_retry() -> None:
    four = {"questions": [question(seq) for seq in range(1, 5)]}
    chat = FakeChat([four, four, five()])

    with pytest.raises(PlanFailedError):
        generate_questions(chat, JOB, CLAIMS)
    assert len(chat.calls) == 2


def test_generate_does_not_retry_unavailable_gms() -> None:
    chat = FakeChat([GmsUnavailableError("5xx"), five()])

    with pytest.raises(GmsUnavailableError):
        generate_questions(chat, JOB, CLAIMS)
    assert len(chat.calls) == 1


# claimId


def test_regenerates_only_question_with_unknown_claim() -> None:
    """claimId가 틀린 3번 질문만 다시 생성하고, 나머지 질문은 그대로 유지한다."""
    chat = FakeChat([five(q3="c9"), regenerated("c2")])

    result = generate_questions(chat, JOB, CLAIMS)

    assert chat.calls[1] == build_regenerate_messages(JOB, CLAIMS, 3)
    assert len(chat.calls) == 2
    assert result.questions[2] == Question(3, "다시 묻는다?", "근거", "c2")
    expected = generate_questions(FakeChat([five()]), JOB, CLAIMS).questions
    assert [q for i, q in enumerate(result.questions) if i != 2] == [
        q for i, q in enumerate(expected) if i != 2
    ]


def test_regenerated_question_keeps_requested_seq() -> None:
    chat = FakeChat([five(q2="c9"), regenerated("c1", seq=5)])

    result = generate_questions(chat, JOB, CLAIMS)

    assert [q.seq for q in result.questions] == [1, 2, 3, 4, 5]
    assert result.questions[1].content == "다시 묻는다?"


def test_regenerates_each_wrong_question_once() -> None:
    chat = FakeChat([five(q1="c9", q4="c8"), regenerated("c1"), regenerated("c2")])

    result = generate_questions(chat, JOB, CLAIMS)

    assert chat.calls[1:] == [
        build_regenerate_messages(JOB, CLAIMS, 1),
        build_regenerate_messages(JOB, CLAIMS, 4),
    ]
    assert [q.claim_id for q in result.questions] == ["c1", "c1", "c1", "c2", "c1"]


@pytest.mark.parametrize(
    "second",
    [regenerated("c9"), {"question": "질문"}, GmsBadOutputError("JSON 아님")],
)
def test_fails_when_regenerated_question_is_still_wrong(second: Any) -> None:
    """다시 생성은 1회이므로 그래도 틀리면 세 번째 호출 없이 실패한다."""
    chat = FakeChat([five(q3="c9"), second, regenerated("c2")])

    with pytest.raises(PlanFailedError):
        generate_questions(chat, JOB, CLAIMS)
    assert len(chat.calls) == 2
