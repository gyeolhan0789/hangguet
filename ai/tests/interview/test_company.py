from typing import Any

import pytest

from app.common.session import Persona
from app.interview.company import business_items, company_items, company_section, talent_items

# 기준: company-pipeline/pipeline/README.md 카드 형식(card-v9)
CARD: dict[str, Any] = {
    "name": "한끗페이",
    "talent": [
        {"title": "해결", "parent": None, "details": ["스스로 문제를 정의하고 해결한다"]},
        {
            "title": "고민은 사용자로부터",
            "parent": "페이코드",
            "details": ["금융을 쉽게", "편하게"],
        },
    ],
    "direction": [{"summary": "해외 결제 확대", "quote": "원문", "source": "사업보고서"}],
    "market": [{"summary": "간편결제 점유율 1위", "quote": "원문", "source": "사업보고서"}],
    "recent": [{"summary": "새 결제 서비스 출시", "published": "2026-10-30"}],
}


def test_talent_items_keep_title_parent_and_details() -> None:
    assert talent_items(CARD) == [
        "해결: 스스로 문제를 정의하고 해결한다",
        "고민은 사용자로부터(페이코드): 금융을 쉽게 / 편하게",
    ]


def test_talent_items_read_card_v8_keyword_and_quote() -> None:
    card = {"talent": [{"keyword": "도전", "quote": "끝까지 도전한다"}]}

    assert talent_items(card) == ["도전: 끝까지 도전한다"]


def test_talent_without_details_keeps_title_only() -> None:
    assert talent_items({"talent": [{"title": "정직", "details": []}]}) == ["정직"]


@pytest.mark.parametrize(
    "talent",
    [
        pytest.param(None, id="missing"),
        pytest.param("도전", id="not-list"),
        pytest.param(["도전"], id="item-not-object"),
        pytest.param([{"title": " ", "details": ["설명"]}], id="blank-title"),
        pytest.param([{"title": 1}], id="title-not-text"),
    ],
)
def test_broken_talent_items_are_skipped(talent: Any) -> None:
    assert talent_items({"talent": talent}) == []


def test_business_items_list_direction_then_market_summaries() -> None:
    assert business_items(CARD) == ["사업 방향: 해외 결제 확대", "시장: 간편결제 점유율 1위"]


def test_business_items_without_summary_are_skipped() -> None:
    card = {"direction": [{"quote": "원문"}, "방향"], "market": None}

    assert business_items(card) == []


def test_devil_uses_talent_only_numbered_from_one() -> None:
    assert company_items(CARD, Persona.DEVIL) == [
        ("co1", "co1 해결: 스스로 문제를 정의하고 해결한다"),
        ("co2", "co2 고민은 사용자로부터(페이코드): 금융을 쉽게 / 편하게"),
    ]
    assert company_section(CARD, Persona.DEVIL).startswith("[회사 인재상]\nco1 해결:")


def test_coffee_chat_uses_direction_and_market_only() -> None:
    section = company_section(CARD, Persona.COFFEE_CHAT)

    assert section == (
        "[회사 사업 방향·시장]\nco1 사업 방향: 해외 결제 확대\nco2 시장: 간편결제 점유율 1위"
    )


def test_duck_uses_talent_then_business_with_continued_numbers() -> None:
    """오리 면접관은 인재상과 사업 방향·시장을 모두 사용하고, 번호가 겹치지 않게 이어서 매긴다."""
    assert [item_id for item_id, _ in company_items(CARD, Persona.DUCK)] == [
        "co1",
        "co2",
        "co3",
        "co4",
    ]
    assert company_section(CARD, Persona.DUCK) == (
        "[회사 인재상]\nco1 해결: 스스로 문제를 정의하고 해결한다\n"
        "co2 고민은 사용자로부터(페이코드): 금융을 쉽게 / 편하게\n\n"
        "[회사 사업 방향·시장]\nco3 사업 방향: 해외 결제 확대\nco4 시장: 간편결제 점유율 1위"
    )


def test_duck_skips_empty_section() -> None:
    card = {"talent": [], "direction": [{"summary": "해외 결제 확대"}]}

    assert company_section(card, Persona.DUCK) == (
        "[회사 사업 방향·시장]\nco1 사업 방향: 해외 결제 확대"
    )


@pytest.mark.parametrize("persona", list(Persona))
@pytest.mark.parametrize(
    "card",
    [None, {}, {"talent": [], "direction": [], "market": []}],
    ids=["none", "empty", "blank"],
)
def test_no_items_and_section_without_usable_entries(card: Any, persona: Persona) -> None:
    assert company_items(card, persona) == []
    assert company_section(card, persona) == ""
