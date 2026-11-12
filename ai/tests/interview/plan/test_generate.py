from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from app.common.cover_letter import CoverLetterItem
from app.common.gms import GmsBadOutputError, GmsUnavailableError
from app.common.session import Persona
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

# 두 주장 모두 실무면접 기준이 드러나 JOB(개발자 면접관)의 질문 생성에 모두 전달한다(AI 명세 2장)
CLAIMS = (
    Claim("c1", "주문 조회 응답 시간을 40% 줄였다", ClaimType.NUMBER, 4, ("실행·성과",)),
    Claim("c2", "캐시 계층을 설계했다", ClaimType.EXPERIENCE, 5, ("전문성·성장",)),
)
GOOD_CLAIMS = {
    "claims": [
        {
            "text": "캐시 계층을 설계했다",
            "type": "EXPERIENCE",
            "sentenceNo": 5,
            "talentCriteria": ["전문성·성장"],
        }
    ]
}
NO_CLAIMS: dict[str, Any] = {"claims": []}
UNSUPPORTED_CLAIMS = {
    "claims": [
        {
            "text": "응답 시간을 90% 줄였다",
            "type": "NUMBER",
            "sentenceNo": 4,
            "talentCriteria": ["실행·성과"],
        }
    ]
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

    assert result.claims == (
        Claim("c1", "캐시 계층을 설계했다", ClaimType.EXPERIENCE, 5, ("전문성·성장",)),
    )
    assert result.model == "gms-served"
    assert len(chat.calls) == 1


# 인재상 기준이 아닌 이름은 판정 값이 틀린 출력이다(AI 명세 2장·5장)
UNKNOWN_CRITERION_CLAIMS = {
    "claims": [
        {
            "text": "캐시 계층을 설계했다",
            "type": "EXPERIENCE",
            "sentenceNo": 5,
            "talentCriteria": ["설계"],
        }
    ]
}


@pytest.mark.parametrize(
    "broken",
    [NO_CLAIMS, UNSUPPORTED_CLAIMS, UNKNOWN_CRITERION_CLAIMS, GmsBadOutputError("JSON 아님")],
)
def test_extract_retries_once_after_broken_output(broken: Any) -> None:
    chat = FakeChat([broken, GOOD_CLAIMS])

    assert len(extract_claims(chat, JOB).claims) == 1
    sentences = split_sentences(JOB.cover_letter_items)
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
            {
                "text": "응답 시간을 60% 줄였다",
                "type": "NUMBER",
                "sentenceNo": 4,
                "talentCriteria": ["실행·성과"],
            },
            {
                "text": "팀원 4명과 절차를 정리했다",
                "type": "EXPERIENCE",
                "sentenceNo": 6,
                "talentCriteria": ["협력·소통"],
            },
        ]
    }

    result = extract_claims(FakeChat([content]), JOB)

    assert result.claims == (
        Claim("c1", "팀원 4명과 절차를 정리했다", ClaimType.EXPERIENCE, 6, ("협력·소통",)),
    )


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
        cover_letter_items=(
            CoverLetterItem(
                "지원 동기",
                "대용량 트래픽을 안정적으로 처리하는 백엔드 개발자가 되고 싶어 지원했습니다.",
            ),
            CoverLetterItem(
                "프로젝트 경험",
                "교내 수강신청 서비스에서 조회 API 응답이 3초 걸리는 문제가 있었습니다. "
                "실행 계획을 분석해 복합 인덱스를 추가했고 응답 시간을 40% 줄였습니다. "
                "또한 Redis 캐시를 도입해 피크 시간 DB 부하를 절반으로 낮췄습니다.",
            ),
            CoverLetterItem("협업", "4명 팀에서 코드 리뷰 규칙을 만들어 배포 오류를 줄였습니다."),
        ),
    )
    content = {
        "claims": [
            {
                "text": "조회 응답 시간을 40% 줄였다",
                "type": "NUMBER",
                "sentenceNo": 5,
                "talentCriteria": ["실행·성과"],
            },
            {"text": text, "type": "NUMBER", "sentenceNo": 6, "talentCriteria": []},
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
        {},
        GmsBadOutputError("JSON 아님"),
    ],
)
def test_generate_retries_once_when_not_five_or_not_json(broken: Any) -> None:
    """질문 수·seq가 틀리거나 JSON이 아니면 1회 재시도한다."""
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


# 면접관별 주장 선택(AI 명세 2장): 주장의 인재상 기준이 면접관 기준과 겹치는 주장만 전달한다
PRACTICAL_CLAIM = Claim(
    "c1", "주문 조회 응답 시간을 40% 줄였다", ClaimType.NUMBER, 4, ("실행·성과",)
)
EXECUTIVE_CLAIM = Claim("c2", "팀원과 갈등을 조율했다", ClaimType.EXPERIENCE, 6, ("협력·소통",))
UNCLASSIFIED_CLAIM = Claim("c3", "캐시 계층을 설계했다", ClaimType.EXPERIENCE, 5)
MIXED_CLAIMS = (PRACTICAL_CLAIM, EXECUTIVE_CLAIM, UNCLASSIFIED_CLAIM)


@pytest.mark.parametrize(
    ("persona", "expected"),
    [
        (Persona.COFFEE_CHAT, (PRACTICAL_CLAIM,)),
        (Persona.DEVIL, (EXECUTIVE_CLAIM,)),
        # 오리 면접관은 12개 기준을 모두 사용하므로 기준이 하나라도 드러난 주장을 전달한다
        (Persona.DUCK, (PRACTICAL_CLAIM, EXECUTIVE_CLAIM)),
    ],
)
def test_question_generation_receives_only_claims_with_interviewer_criteria(
    persona: Persona, expected: tuple[Claim, ...]
) -> None:
    job = replace(JOB, persona=persona)
    chat = FakeChat(
        [
            five(
                q1=expected[0].id,
                q2=expected[0].id,
                q3=expected[0].id,
                q4=expected[0].id,
                q5=expected[0].id,
            )
        ]
    )

    generate_questions(chat, job, MIXED_CLAIMS)

    assert chat.calls == [build_question_messages(job, expected)]


def test_regenerates_question_on_claim_not_passed_to_question_generation() -> None:
    """질문 생성에 전달하지 않은 주장을 가리킨 질문은 전달한 주장만으로 다시 생성한다."""
    chat = FakeChat([five(q3="c2"), regenerated("c1")])

    result = generate_questions(chat, JOB, MIXED_CLAIMS)

    assert chat.calls[1] == build_regenerate_messages(JOB, (PRACTICAL_CLAIM,), 3)
    assert [q.claim_id for q in result.questions] == ["c1"] * 5


def test_uses_all_claims_when_no_claim_shows_interviewer_criterion() -> None:
    """면접 종류와 맞지 않는 자기소개서여도 플랜 생성이 실패하지 않도록 모든 주장을 전달한다."""
    claims = (EXECUTIVE_CLAIM, UNCLASSIFIED_CLAIM)
    chat = FakeChat([five(q1="c2", q2="c3", q3="c2", q4="c2", q5="c2")])

    result = generate_questions(chat, JOB, claims)

    assert chat.calls == [build_question_messages(JOB, claims)]
    assert [q.claim_id for q in result.questions] == ["c2", "c3", "c2", "c2", "c2"]


# 회사 정보 연결(AI 명세 2장 회사 카드 사용). JOB은 백엔드 개발자를 뽑는 개발자 면접관이므로
# 사업 방향·시장 중 응용SW엔지니어링 분류값이 부여된 항목을 사용한다.
# 회사 항목은 co1부터 번호를 매긴다(co1 해외 결제 확대, co2 점유율 1위)
SW = ["응용SW엔지니어링"]
CARD = {
    "direction": [{"summary": "해외 결제 확대", "ncs_subcategories": SW}],
    "market": [{"summary": "점유율 1위", "ncs_subcategories": SW}],
}
CARD_JOB = replace(JOB, company_card=CARD)
# 악마 면접관 기준이 드러난 주장이 없어 두 주장을 모두 사용하고(면접관별 주장 선택),
# 인재상 항목(co1)은 분류값과 기준이 같은 c1과만 연결할 수 있다
DEVIL_CARD_JOB = replace(
    JOB,
    persona=Persona.DEVIL,
    company_card={"talent": [{"title": "해결", "criterion": "실행·성과"}]},
)


def linked(*items: str) -> dict[str, Any]:
    """앞 질문부터 순서대로 companyItem을 채운 질문 5개."""
    reply = five()
    for question_item, company_item in zip(reply["questions"], items, strict=False):
        question_item["companyItem"] = company_item
    return reply


@pytest.mark.parametrize("items", [(), ("co1",), ("co1", "co2"), ("co1", "")])
def test_practical_interview_accepts_zero_to_two_company_links(items: tuple[str, ...]) -> None:
    chat = FakeChat([linked(*items)])

    result = generate_questions(chat, CARD_JOB, CLAIMS)

    assert len(chat.calls) == 1
    assert [q.company_item for q in result.questions[: len(items)]] == [i or None for i in items]


@pytest.mark.parametrize("persona", list(Persona))
@pytest.mark.parametrize("items", [(), ("co1",)])
def test_every_interviewer_accepts_zero_or_one_company_link(
    persona: Persona, items: tuple[str, ...]
) -> None:
    """모든 면접관이 회사 정보 연결을 강제하지 않는다(AI 명세 2장, 0~2개)."""
    card = {**CARD, "talent": [{"title": "해결", "criterion": "실행·성과"}]}
    chat = FakeChat([linked(*items)])

    generate_questions(chat, replace(JOB, persona=persona, company_card=card), CLAIMS)

    assert len(chat.calls) == 1


@pytest.mark.parametrize(
    "first",
    [
        pytest.param(linked("co1", "co2", "co1"), id="three-links"),
        pytest.param(linked("co3"), id="item-not-in-card"),
        pytest.param(linked("해외 결제 확대"), id="item-name-instead-of-id"),
    ],
)
def test_wrong_company_links_are_retried_once(first: dict[str, Any]) -> None:
    chat = FakeChat([first, linked("co1")])

    generate_questions(chat, CARD_JOB, CLAIMS)

    assert len(chat.calls) == 2


def test_talent_link_to_claim_with_other_criterion_is_retried() -> None:
    """인재상 항목은 분류값과 인재상 기준이 같은 주장과만 연결할 수 있다(AI 명세 2장)."""
    wrong = linked("co1")
    wrong["questions"][0]["claimId"] = "c2"
    chat = FakeChat([wrong, linked("co1")])

    result = generate_questions(chat, DEVIL_CARD_JOB, CLAIMS)

    assert len(chat.calls) == 2
    assert (result.questions[0].claim_id, result.questions[0].company_item) == ("c1", "co1")


def test_link_to_unclassified_item_is_retried() -> None:
    """분류값이 없는 항목은 후보가 아니므로 번호가 매겨지지 않는다."""
    job = replace(JOB, company_card={"direction": [{"summary": "해외 결제 확대"}]})
    chat = FakeChat([linked("co1"), five()])

    generate_questions(chat, job, CLAIMS)

    assert len(chat.calls) == 2


def test_company_link_without_card_is_retried() -> None:
    """카드가 없는데 회사 항목을 연결했다면 주어지지 않은 회사 정보를 전제로 한 질문이다."""
    chat = FakeChat([linked("co1"), five()])

    generate_questions(chat, JOB, CLAIMS)

    assert len(chat.calls) == 2


def test_last_attempt_keeps_questions_with_wrong_company_links() -> None:
    """회사 정보 연결이 어긋나도 플랜 생성 전체가 실패하지 않도록 마지막 시도는 그대로 사용한다."""
    three = linked("co1", "co1", "co1")
    chat = FakeChat([three, three])

    result = generate_questions(chat, DEVIL_CARD_JOB, CLAIMS)

    assert len(chat.calls) == 2
    assert [q.company_item for q in result.questions] == ["co1", "co1", "co1", None, None]


def test_last_attempt_drops_company_item_not_in_candidates(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """마지막 시도에서 후보에 없는 회사 항목 번호는 가리키는 항목이 없어 연결하지 않는다."""
    wrong = linked("co9", "co1")
    chat = FakeChat([wrong, wrong])

    result = generate_questions(chat, CARD_JOB, CLAIMS)

    assert [q.company_item for q in result.questions[:2]] == [None, "co1"]
    assert "회사 항목 번호가 후보에 없어 연결하지 않는다 seq=1" in caplog.text


def test_regenerated_question_keeps_company_item() -> None:
    """회사 항목과 연결한 질문을 다시 생성하면 같은 회사 항목과 연결한다."""
    first = linked("co1")
    first["questions"][0]["claimId"] = "c9"
    chat = FakeChat([first, regenerated("c2")])

    result = generate_questions(chat, CARD_JOB, CLAIMS)

    item = result.company_items[0]
    assert chat.calls[1] == build_regenerate_messages(CARD_JOB, CLAIMS, 1, item)
    assert (result.questions[0].claim_id, result.questions[0].company_item) == ("c2", "co1")


def test_regenerated_talent_question_uses_only_claims_of_that_item() -> None:
    """인재상 항목과 연결한 질문은 그 항목과 연결할 수 있는 주장으로만 다시 생성한다."""
    wrong = linked("co1")
    wrong["questions"][0]["claimId"] = "c9"
    chat = FakeChat([wrong, wrong, regenerated("c1")])

    result = generate_questions(chat, DEVIL_CARD_JOB, CLAIMS)

    item = result.company_items[0]
    assert chat.calls[2] == build_regenerate_messages(DEVIL_CARD_JOB, CLAIMS[:1], 1, item)
    assert (result.questions[0].claim_id, result.questions[0].company_item) == ("c1", "co1")


def test_regenerated_talent_question_with_claim_not_given_fails() -> None:
    """인재상 항목과 연결할 수 없는 주장은 다시 생성할 때 전달하지 않은 주장이므로
    다른 claimId 오류와 같이 처리한다.
    """
    wrong = linked("co1")
    wrong["questions"][0]["claimId"] = "c9"
    chat = FakeChat([wrong, wrong, regenerated("c2")])

    with pytest.raises(PlanFailedError):
        generate_questions(chat, DEVIL_CARD_JOB, CLAIMS)
