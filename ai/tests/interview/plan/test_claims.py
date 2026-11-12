import logging
from typing import Any

import pytest
from company_taxonomy.talent_criteria import TALENT_CRITERIA

from app.common.cover_letter import CoverLetterItem
from app.interview.plan.claims import (
    build_claim_messages,
    parse_claims,
    request_claims,
    split_sentences,
)
from app.interview.plan.llm import PlanOutputError
from app.interview.plan.rules import MAX_CLAIMS
from app.interview.talent import criteria_lines
from app.worker.messages import Claim, ClaimType
from tests.interview.plan.fakes import JOB, FakeChat

SENTENCES = split_sentences(JOB.cover_letter_items)


def claim(
    text: Any, claim_type: Any, sentence_no: Any, talent_criteria: Any = ()
) -> dict[str, Any]:
    return {
        "text": text,
        "type": claim_type,
        "sentenceNo": sentence_no,
        "talentCriteria": list(talent_criteria),
    }


def test_splits_cover_letter_by_lines_and_sentence_endings() -> None:
    """문항마다 질문 다음에 답변 문장을 잇는다. 빈 줄은 포함하지 않는다."""
    assert SENTENCES == [
        "지원 동기",
        "저는 대용량 트래픽을 다루는 서비스를 만들고 싶습니다.",
        "직무 경험",
        "주문 조회 API의 응답 시간을 40% 줄였습니다.",
        "캐시 계층을 직접 설계했습니다.",
        "팀원 4명과 장애 대응 절차를 정리했습니다.",
    ]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("왜 그랬을까? 원인을 찾았다!  다음 문장", ["왜 그랬을까?", "원인을 찾았다!", "다음 문장"]),
        ("버전 3.2로 올렸다. 끝", ["버전 3.2로 올렸다.", "끝"]),
        ("평균 1.5초가 걸렸다. 다음", ["평균 1.5초가 걸렸다.", "다음"]),
        ("10. 마지막 문항", ["10. 마지막 문항"]),
        ("Spring. 그리고 응답(40%). 다음", ["Spring.", "그리고 응답(40%).", "다음"]),
        ("(직접 설계했다.) 다음", ["(직접 설계했다.)", "다음"]),
        ("“끝까지 하자.” 다짐했다. 다음", ["“끝까지 하자.”", "다짐했다.", "다음"]),
        ('"좋다." 다음', ['"좋다."', "다음"]),
        ("  \n\n  ", []),
    ],
)
def test_sentence_break_rule(text: str, expected: list[str]) -> None:
    assert split_sentences([CoverLetterItem("문항", text)]) == ["문항", *expected]


def test_question_is_split_by_the_same_rule_before_its_answer() -> None:
    """AI 명세 2장: 문항 질문도 답변과 같은 규칙으로 나누고 순번을 이어서 센다."""
    items = [CoverLetterItem("지원 동기를 쓰세요. 500자 이내로.", "답변입니다.")]

    sentences = split_sentences(items)

    assert sentences == ["지원 동기를 쓰세요.", "500자 이내로.", "답변입니다."]
    user = build_claim_messages(JOB, sentences)[1]["content"]
    assert user.endswith("[1] 지원 동기를 쓰세요.\n[2] 500자 이내로.\n[3] 답변입니다.")


def test_messages_number_sentences_with_company_and_job() -> None:
    messages = build_claim_messages(JOB, SENTENCES)

    assert [m["role"] for m in messages] == ["system", "user"]
    user = messages[1]["content"]
    assert user.startswith("회사: ○○전자\n직무: 백엔드 개발자\n\n[자기소개서 문장]\n")
    assert "[1] 지원 동기\n[2] 저는 대용량" in user
    assert user.endswith("[6] 팀원 4명과 장애 대응 절차를 정리했습니다.")


def test_system_lists_twelve_talent_criteria_for_talent_criteria_field() -> None:
    """주장마다 인재상 기준 12개 중 드러난 기준 이름 0~2개를 담게 한다(AI 명세 2장 STEP 01)."""
    system = build_claim_messages(JOB, SENTENCES)[0]["content"]

    assert "- talentCriteria: 아래 인재상 기준 중 그 주장에 드러난 기준 이름 0~2개" in system
    assert f"[인재상 기준]\n{criteria_lines(TALENT_CRITERIA)}" in system
    assert '"talentCriteria": [str]' in system


def test_parses_claims_and_assigns_ids_in_order() -> None:
    """GMS가 작성한 id는 무시하고 c1부터 순서대로 부여한다."""
    content = {
        "claims": [
            {**claim("주문 조회 응답 시간을 40% 줄였다", "NUMBER", 4), "id": "c7"},
            {**claim(" 캐시 계층을 설계했다 ", "EXPERIENCE", 5), "id": "c7"},
        ]
    }

    assert parse_claims(content, SENTENCES) == (
        Claim("c1", "주문 조회 응답 시간을 40% 줄였다", ClaimType.NUMBER, 4),
        Claim("c2", "캐시 계층을 설계했다", ClaimType.EXPERIENCE, 5),
    )


def test_parses_talent_criteria_of_each_claim() -> None:
    content = {
        "claims": [
            claim("주문 조회 응답 시간을 40% 줄였다", "NUMBER", 4, ["실행·성과", "전문성·성장"]),
            claim("캐시 계층을 설계했다", "EXPERIENCE", 5, []),
        ]
    }

    claims = parse_claims(content, SENTENCES)

    assert [c.talent_criteria for c in claims] == [("실행·성과", "전문성·성장"), ()]


@pytest.mark.parametrize(
    "content",
    [
        {},
        {"claims": "c1"},
        {"claims": []},
        {"claims": ["캐시 계층을 설계했다"]},
        {"claims": [claim("", "EXPERIENCE", 5)]},
        {"claims": [claim("  ", "EXPERIENCE", 5)]},
        {"claims": [claim(None, "EXPERIENCE", 5)]},
        {"claims": [claim("캐시 계층을 설계했다", "SKILL", 5)]},
        {"claims": [claim("캐시 계층을 설계했다", None, 5)]},
        {"claims": [claim("캐시 계층을 설계했다", "EXPERIENCE", 0)]},
        {"claims": [claim("캐시 계층을 설계했다", "EXPERIENCE", 7)]},
        {"claims": [claim("캐시 계층을 설계했다", "EXPERIENCE", "5")]},
        {"claims": [claim("캐시 계층을 설계했다", "EXPERIENCE", 5.0)]},
        {"claims": [claim("1. 지원 동기", "EXPERIENCE", True)]},
    ],
)
def test_broken_structure_is_output_error(content: dict[str, Any]) -> None:
    with pytest.raises(PlanOutputError):
        parse_claims(content, SENTENCES)


@pytest.mark.parametrize(
    "talent_criteria",
    [
        None,
        "실행·성과",
        ["실행"],
        ["실행·성과", "실행·성과"],
        ["실행·성과", "전문성·성장", "협력·소통"],
        [1],
    ],
)
def test_wrong_talent_criteria_is_output_error(talent_criteria: Any) -> None:
    """기준 12개에 없는 이름, 중복, 3개 이상은 판정 값이 틀린 출력이다(AI 명세 2장·5장)."""
    item = {"text": "캐시 계층을 설계했다", "type": "EXPERIENCE", "sentenceNo": 5}
    if talent_criteria is not None:
        item["talentCriteria"] = talent_criteria
    with pytest.raises(PlanOutputError, match="talentCriteria"):
        parse_claims({"claims": [item]}, SENTENCES)


def test_last_sentence_number_is_in_range() -> None:
    content = {"claims": [claim("팀원 4명과 절차를 정리했다", "EXPERIENCE", len(SENTENCES))]}

    assert parse_claims(content, SENTENCES)[0].sentence_no == len(SENTENCES)


def test_max_claims_is_accepted() -> None:
    content = {"claims": [claim("캐시 계층을 설계했다", "EXPERIENCE", 5)] * MAX_CLAIMS}

    claims = parse_claims(content, SENTENCES)

    assert [c.id for c in claims] == [f"c{no}" for no in range(1, MAX_CLAIMS + 1)]


def test_claims_over_max_keep_first_max(caplog: pytest.LogCaptureFixture) -> None:
    """상한은 AI 내부 값이므로 초과해도 실패시키지 않고 앞의 주장만 사용한다."""
    over = [claim("캐시 계층을 설계했다", "EXPERIENCE", 5)] * MAX_CLAIMS
    content = {"claims": [*over, claim("응답 시간을 40% 줄였다", "NUMBER", 4)]}

    with caplog.at_level(logging.WARNING):
        claims = parse_claims(content, SENTENCES)

    assert len(claims) == MAX_CLAIMS
    assert all(c.sentence_no == 5 for c in claims)
    assert f"앞의 {MAX_CLAIMS}개만 사용" in caplog.text


def test_broken_item_after_max_is_ignored() -> None:
    """상한 뒤의 항목은 사용하지 않으므로 형식을 검사하지 않는다."""
    over = [claim("캐시 계층을 설계했다", "EXPERIENCE", 5)] * MAX_CLAIMS
    content = {"claims": [*over, claim("", "SKILL", 99)]}

    assert len(parse_claims(content, SENTENCES)) == MAX_CLAIMS


def test_request_claims_calls_gms_once_and_keeps_model() -> None:
    chat = FakeChat([{"claims": [claim("응답 시간을 40% 줄였다", "NUMBER", 4)]}])

    result = request_claims(chat, JOB)

    assert chat.calls == [build_claim_messages(JOB, SENTENCES)]
    assert result.claims == (Claim("c1", "응답 시간을 40% 줄였다", ClaimType.NUMBER, 4),)
    assert result.model == "gms-served"
