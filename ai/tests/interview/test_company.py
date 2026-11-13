from typing import Any

import pytest

from app.common.session import Persona
from app.interview.company import (
    CompanyItem,
    company_item_text,
    company_items,
    company_section,
    persona_card,
)
from app.worker.messages import Claim, ClaimType

# 기준: company-pipeline/pipeline/README.md 카드 형식(card-v11, 분류값 포함)
CARD: dict[str, Any] = {
    "name": "한끗페이",
    "talent": [
        {
            "title": "해결",
            "parent": None,
            "details": ["스스로 문제를 정의하고 해결한다"],
            "criterion": "책임·주도성",
        },
        {
            "title": "고민은 사용자로부터",
            "parent": "페이코드",
            "details": ["금융을 쉽게", "편하게"],
            "criterion": "고객·사용자 중심",
        },
    ],
    "direction": [
        {
            "summary": "해외 결제 확대",
            "quote": "해외 결제 서비스를 확대할 계획이다",
            "source": "사업보고서",
            "ncs_subcategories": ["응용SW엔지니어링"],
        }
    ],
    "market": [
        {
            "summary": "간편결제 점유율 1위",
            "quote": "간편결제 시장 점유율 1위를 유지하고 있다",
            "source": "사업보고서",
            "ncs_subcategories": ["IT마케팅", "DB엔지니어링"],
        }
    ],
    "recent": [
        {
            "summary": "새 결제 서비스 출시",
            "quote": "한끗페이, 새 결제 서비스 출시",
            "published": "2026-10-30",
            "ncs_subcategories": ["응용SW엔지니어링"],
        }
    ],
}
CLAIMS = (
    Claim("c1", "장애를 직접 수습했다", ClaimType.EXPERIENCE, 3, ("책임·주도성",)),
    Claim("c2", "결제 화면 이탈을 줄였다", ClaimType.NUMBER, 4, ("고객·사용자 중심",)),
    Claim("c3", "장애 원인을 찾았다", ClaimType.EXPERIENCE, 5, ("책임·주도성", "실행·성과")),
)
# 백엔드 개발자의 NCS 세분류(app.interview.job_ncs)
BACKEND = ("응용SW엔지니어링", "SW아키텍처", "DB엔지니어링")


def items(card: Any, persona: Persona, subcategories: tuple[str, ...] = BACKEND) -> list[Any]:
    return company_items(card, persona, CLAIMS, subcategories)


def test_devil_uses_talent_and_recent_issues() -> None:
    """악마 면접관은 인재상·최근 이슈를 사용한다(AI 명세 2장).

    인재상 항목은 분류값이 주장의 인재상 기준에 있을 때만 후보이고, 그 주장과만 연결한다.
    """
    assert items(CARD, Persona.DEVIL) == [
        CompanyItem(
            "co1",
            "회사 인재상",
            "해결: 스스로 문제를 정의하고 해결한다",
            ("c1", "c3"),
            "talent",
            CARD["talent"][0],
        ),
        CompanyItem(
            "co2",
            "회사 인재상",
            "고민은 사용자로부터(페이코드): 금융을 쉽게 / 편하게",
            ("c2",),
            "talent",
            CARD["talent"][1],
        ),
        CompanyItem(
            "co3",
            "회사 최근 이슈",
            "2026-10-30: 새 결제 서비스 출시 (원문: 한끗페이, 새 결제 서비스 출시)",
            None,
            "recent",
            CARD["recent"][0],
        ),
    ]


def test_talent_without_claim_of_same_criterion_is_not_candidate() -> None:
    claims = (CLAIMS[1],)

    result = company_items({"talent": CARD["talent"]}, Persona.DEVIL, claims, BACKEND)

    assert [item.text for item in result] == ["고민은 사용자로부터(페이코드): 금융을 쉽게 / 편하게"]


def test_talent_items_read_card_v8_keyword_and_quote() -> None:
    card = {"talent": [{"keyword": "도전", "quote": "끝까지 도전한다", "criterion": "책임·주도성"}]}

    assert [item.text for item in items(card, Persona.DEVIL)] == ["도전: 끝까지 도전한다"]


def test_talent_without_details_keeps_title_only() -> None:
    card = {"talent": [{"title": "정직", "details": [], "criterion": "책임·주도성"}]}

    assert [item.text for item in items(card, Persona.DEVIL)] == ["정직"]


@pytest.mark.parametrize(
    "talent",
    [
        pytest.param(None, id="missing"),
        pytest.param("도전", id="not-list"),
        pytest.param(["도전"], id="item-not-object"),
        pytest.param([{"title": " ", "criterion": "책임·주도성"}], id="blank-title"),
        pytest.param([{"title": 1, "criterion": "책임·주도성"}], id="title-not-text"),
        # 분류값을 추가하기 전에 만든 카드나 분류에 실패한 항목(AI 명세 8장)
        pytest.param([{"title": "해결"}], id="no-criterion"),
        pytest.param([{"title": "해결", "criterion": None}], id="criterion-not-text"),
    ],
)
def test_broken_or_unclassified_talent_items_are_skipped(talent: Any) -> None:
    assert items({"talent": talent}, Persona.DEVIL) == []


def test_coffee_chat_business_and_recent_items_need_job_subcategory() -> None:
    """개발자 면접관은 사업 방향·시장·최근 이슈를 사용한다(AI 명세 2장).

    분류값에 지원 직무 세분류가 있는 항목만 후보이고 주장 제한이 없다.
    """
    assert items(CARD, Persona.COFFEE_CHAT) == [
        CompanyItem(
            "co1",
            "회사 사업 방향·시장",
            "사업 방향: 해외 결제 확대 (원문: 해외 결제 서비스를 확대할 계획이다)",
            None,
            "direction",
            CARD["direction"][0],
        ),
        CompanyItem(
            "co2",
            "회사 사업 방향·시장",
            "시장: 간편결제 점유율 1위 (원문: 간편결제 시장 점유율 1위를 유지하고 있다)",
            None,
            "market",
            CARD["market"][0],
        ),
        CompanyItem(
            "co3",
            "회사 최근 이슈",
            "2026-10-30: 새 결제 서비스 출시 (원문: 한끗페이, 새 결제 서비스 출시)",
            None,
            "recent",
            CARD["recent"][0],
        ),
    ]
    assert [item.text for item in items(CARD, Persona.COFFEE_CHAT, ("DB엔지니어링",))] == [
        "시장: 간편결제 점유율 1위 (원문: 간편결제 시장 점유율 1위를 유지하고 있다)"
    ]


@pytest.mark.parametrize(
    "entry",
    [
        pytest.param({"summary": "해외 결제 확대"}, id="no-subcategories"),
        pytest.param({"summary": "해외 결제 확대", "ncs_subcategories": []}, id="none-applies"),
        pytest.param(
            {"summary": "해외 결제 확대", "ncs_subcategories": "응용SW엔지니어링"}, id="not-list"
        ),
        pytest.param({"ncs_subcategories": ["응용SW엔지니어링"]}, id="no-summary"),
    ],
)
@pytest.mark.parametrize("section", ["direction", "market", "recent"])
def test_items_without_matching_subcategory_are_skipped(
    entry: dict[str, Any], section: str
) -> None:
    assert items({section: [entry]}, Persona.COFFEE_CHAT) == []


def test_recent_issue_without_published_date_keeps_summary_only() -> None:
    card = {
        "recent": [{"summary": "새 결제 서비스 출시", "ncs_subcategories": ["응용SW엔지니어링"]}]
    }

    assert [item.text for item in items(card, Persona.COFFEE_CHAT)] == ["새 결제 서비스 출시"]


def test_job_without_subcategory_has_no_business_items() -> None:
    """직무 묶음에 해당하지 않는 직무명은 세분류가 없어 사업 방향·시장·최근 이슈 항목을
    연결하지 않는다.
    """
    assert items(CARD, Persona.COFFEE_CHAT, ()) == []


def test_duck_uses_all_sections_with_continued_numbers() -> None:
    """오리 면접관은 인재상·사업 방향·시장·최근 이슈를 모두 사용한다.

    번호는 구역이 바뀌어도 겹치지 않게 이어서 매기고,
    인재상 항목 줄에는 연결할 수 있는 주장을 함께 작성한다.
    """
    result = items(CARD, Persona.DUCK)

    assert [item.id for item in result] == ["co1", "co2", "co3", "co4", "co5"]
    assert company_section(result) == (
        "[회사 인재상]\nco1 해결: 스스로 문제를 정의하고 해결한다 (연결 가능한 주장: c1, c3)\n"
        "co2 고민은 사용자로부터(페이코드): 금융을 쉽게 / 편하게 (연결 가능한 주장: c2)\n\n"
        "[회사 사업 방향·시장]\n"
        "co3 사업 방향: 해외 결제 확대 (원문: 해외 결제 서비스를 확대할 계획이다)\n"
        "co4 시장: 간편결제 점유율 1위 (원문: 간편결제 시장 점유율 1위를 유지하고 있다)\n\n"
        "[회사 최근 이슈]\n"
        "co5 2026-10-30: 새 결제 서비스 출시 (원문: 한끗페이, 새 결제 서비스 출시)"
    )


def test_duck_skips_section_without_candidates() -> None:
    card = {"talent": [], "direction": CARD["direction"]}

    assert company_section(items(card, Persona.DUCK)) == (
        "[회사 사업 방향·시장]\n"
        "co1 사업 방향: 해외 결제 확대 (원문: 해외 결제 서비스를 확대할 계획이다)"
    )


def test_business_and_recent_items_without_quote_keep_summary_only() -> None:
    """원문이 없는 항목은 원문 없이 전달한다."""
    card = {
        "direction": [{"summary": "해외 결제 확대", "ncs_subcategories": ["응용SW엔지니어링"]}],
        "recent": [{"summary": "새 결제 서비스 출시", "ncs_subcategories": ["응용SW엔지니어링"]}],
    }

    assert [item.text for item in items(card, Persona.COFFEE_CHAT)] == [
        "사업 방향: 해외 결제 확대",
        "새 결제 서비스 출시",
    ]


@pytest.mark.parametrize("persona", list(Persona))
@pytest.mark.parametrize(
    "card",
    [None, {}, {"talent": [], "direction": [], "market": [], "recent": []}],
    ids=["none", "empty", "blank"],
)
def test_no_items_and_section_without_usable_entries(card: Any, persona: Persona) -> None:
    assert items(card, persona) == []
    assert company_section(items(card, persona)) == ""


def test_item_json_is_card_section_and_entry() -> None:
    """플랜에 저장하는 연결 회사 항목은 카드 칸 이름과 카드 항목의 칸 그대로다(AI 명세 2장)."""
    assert [item.json() for item in items(CARD, Persona.DUCK)] == [
        {"section": "talent", **CARD["talent"][0]},
        {"section": "talent", **CARD["talent"][1]},
        {"section": "direction", **CARD["direction"][0]},
        {"section": "market", **CARD["market"][0]},
        {"section": "recent", **CARD["recent"][0]},
    ]


@pytest.mark.parametrize(
    ("section", "entry", "text"),
    [
        ("talent", CARD["talent"][1], "고민은 사용자로부터(페이코드): 금융을 쉽게 / 편하게"),
        (
            "direction",
            CARD["direction"][0],
            "사업 방향: 해외 결제 확대 (원문: 해외 결제 서비스를 확대할 계획이다)",
        ),
        (
            "market",
            CARD["market"][0],
            "시장: 간편결제 점유율 1위 (원문: 간편결제 시장 점유율 1위를 유지하고 있다)",
        ),
        (
            "recent",
            CARD["recent"][0],
            "2026-10-30: 새 결제 서비스 출시 (원문: 한끗페이, 새 결제 서비스 출시)",
        ),
        ("recent", {"summary": "새 결제 서비스 출시"}, "새 결제 서비스 출시"),
    ],
    ids=["talent", "direction", "market", "recent", "recent-without-date-and-quote"],
)
def test_company_item_text_by_section(section: str, entry: dict[str, Any], text: str) -> None:
    """카드 칸 이름과 카드 항목으로 질문 생성 후보와 같은 형식의 글을 만든다."""
    assert company_item_text(section, entry) == text


@pytest.mark.parametrize(
    ("section", "entry"),
    [
        ("talent", {"details": ["설명만 있음"]}),
        ("direction", {"quote": "요약 없음"}),
        ("unknown", {"summary": "모르는 칸"}),
    ],
    ids=["talent-without-title", "without-summary", "unknown-section"],
)
def test_company_item_text_is_none_without_text(section: str, entry: dict[str, Any]) -> None:
    assert company_item_text(section, entry) is None


@pytest.mark.parametrize(
    ("persona", "keys"),
    [
        (Persona.DEVIL, ["talent", "recent"]),
        (Persona.COFFEE_CHAT, ["direction", "market", "recent"]),
        (Persona.DUCK, ["talent", "direction", "market", "recent"]),
    ],
)
def test_persona_card_keeps_interviewer_sections(persona: Persona, keys: list[str]) -> None:
    """결과 피드백도 질문 생성과 같은 카드 칸을 사용한다(AI 명세 4장)."""
    assert persona_card(CARD, persona) == {key: CARD[key] for key in keys}


def test_persona_card_skips_missing_sections() -> None:
    assert persona_card({"recent": []}, Persona.DUCK) == {"recent": []}
