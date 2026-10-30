from dataclasses import replace
from typing import Any

import pytest

from app.common.session import QUESTION_COUNT, Persona
from app.interview.plan.llm import PlanOutputError
from app.interview.plan.questions import (
    Question,
    build_question_messages,
    build_regenerate_messages,
    parse_questions,
    request_questions,
)
from app.worker.messages import Claim, ClaimType
from tests.interview.plan.fakes import JOB, FakeChat, question

CLAIMS = (
    Claim("c1", "주문 조회 응답 시간을 40% 줄였다", ClaimType.NUMBER, 4),
    Claim("c2", "캐시 계층을 설계했다", ClaimType.EXPERIENCE, 5),
)


def test_question_count_matches_spec() -> None:
    """AI 명세 2장: 질문은 seq 1~5로 정확히 5개다."""
    assert QUESTION_COUNT == 5


def test_messages_list_claims_with_ids() -> None:
    messages = build_question_messages(JOB, CLAIMS)

    assert [m["role"] for m in messages] == ["system", "user"]
    assert "정확히 5개, seq는 1부터 5까지 하나씩" in messages[0]["content"]
    assert messages[1]["content"] == (
        "회사: ○○전자\n직무: 백엔드 개발자\n\n[주장]\n"
        "c1 (NUMBER, 문장 4) 주문 조회 응답 시간을 40% 줄였다\n"
        "c2 (EXPERIENCE, 문장 5) 캐시 계층을 설계했다"
    )


# 기준: AI 명세 2장 면접관별 질문 수준(개발자 면접관 = 실무면접, 구조 이해)
PRACTICAL_GUIDE = "이 면접은 실무면접이다. 지원자가 자기소개서 경험의 구조를 이해하고 있는지 묻는다"
PRACTICAL_EXCLUDED = "라이브러리 내부 구현·수치나 명령어 암기·코드 작성은 요구하지 않는다"


def test_coffee_chat_questions_ask_structure_understanding() -> None:
    job = replace(JOB, persona=Persona.COFFEE_CHAT)

    for messages in (
        build_question_messages(job, CLAIMS),
        build_regenerate_messages(job, CLAIMS, 3),
    ):
        system = messages[0]["content"]
        assert PRACTICAL_GUIDE in system
        assert PRACTICAL_EXCLUDED in system


def test_devil_questions_do_not_use_practical_guide() -> None:
    """임원면접 지침은 질문 예시와 함께 추가하므로 그 전까지는 실무면접 지침을 쓰지 않는다."""
    job = replace(JOB, persona=Persona.DEVIL)

    for messages in (
        build_question_messages(job, CLAIMS),
        build_regenerate_messages(job, CLAIMS, 3),
    ):
        assert PRACTICAL_GUIDE not in messages[0]["content"]


def test_parses_questions() -> None:
    content = {"questions": [question(1), {**question(2, "c2"), "content": " 캐시를 왜? "}]}

    assert parse_questions(content) == (
        Question(1, "1번 질문의 근거는 무엇인가?", "원인 분석 · 수치 근거", "c1"),
        Question(2, "캐시를 왜?", "원인 분석 · 수치 근거", "c2"),
    )


def test_parse_keeps_count_and_seq_as_received() -> None:
    """질문 수와 seq는 결과 검증 단계가 검사하므로 형식 검사에서는 그대로 유지한다."""
    content = {"questions": [question(seq) for seq in (9, 9, 0)]}

    assert [q.seq for q in parse_questions(content)] == [9, 9, 0]


@pytest.mark.parametrize(
    "content",
    [
        {},
        {"questions": {"seq": 1}},
        {"questions": ["질문"]},
        {"questions": [question("1")]},
        {"questions": [question(True)]},
        {"questions": [question(1.0)]},
        {"questions": [{**question(1), "content": " "}]},
        {"questions": [{**question(1), "criteria": None}]},
        {"questions": [{**question(1), "claimId": 1}]},
        {"questions": [question(1), "질문"]},
    ],
)
def test_broken_question_is_output_error(content: dict[str, Any]) -> None:
    with pytest.raises(PlanOutputError):
        parse_questions(content)


def test_request_questions_calls_gms_once_and_keeps_model() -> None:
    chat = FakeChat([{"questions": [question(seq) for seq in range(1, 6)]}])

    result = request_questions(chat, JOB, CLAIMS)

    assert chat.calls == [build_question_messages(JOB, CLAIMS)]
    assert [q.seq for q in result.questions] == [1, 2, 3, 4, 5]
    assert result.model == "gms-served"
