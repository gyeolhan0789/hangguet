import json
from pathlib import Path

import pytest

from pipeline import card
from pipeline.card import (
    PROMPT_VERSION,
    build_messages,
    business_input,
    link_articles,
    market_input,
    news_input,
    parse_reply,
    to_card,
)
from pipeline.verify import normalize, verify_card

FIXTURES = Path(__file__).parent / "fixtures"
# 2026-10-19 로컬 qwen3:8b가 카카오뱅크 자료로 만든 실제 응답 (인재상 원문은 비워서 보냄)
REPLY = (FIXTURES / "llm_reply_kakaobank.json").read_text(encoding="utf-8")

# 실제 사업보고서 문장을 줄인 샘플. 한 줄에 문장이 붙어 있는 경우도 있다
BUSINESS = (
    "1. 사업의 개요\n"
    "당사는 메모리 반도체를 생산하는 글로벌 반도체 기업입니다.\n"
    "2026년에도 제품 경쟁력을 기반으로 AI 시대를 선도해 나갈 계획입니다."
    "HBM4를 적기에 공급 확대하여 고객 수요에 적극 대응할 계획입니다.\n"
    "당사는 2050년까지 탄소중립을 달성하기 위한 노력을 지속적으로 추진할 계획입니다.\n"
    "당사는 환율변동 리스크를 최소화하는데 주력하고 있습니다.\n"
)


def test_business_input_keeps_only_company_plan_sentences() -> None:
    lines = business_input(BUSINESS).split("\n")
    assert lines == [
        "2026년에도 제품 경쟁력을 기반으로 AI 시대를 선도해 나갈 계획입니다.",
        "HBM4를 적기에 공급 확대하여 고객 수요에 적극 대응할 계획입니다.",
    ]  # 소개 문장, 탄소중립(ESG), 환율(재무 위험) 문장은 뺀다


def test_build_messages_includes_both_sources() -> None:
    user = build_messages("테스트은행", "고객 중심", "비대면 금융")[1]["content"]
    assert "고객 중심" in user
    assert "비대면 금융" in user


def test_parse_reply_strips_think_block() -> None:
    assert parse_reply('<think>\n고민\n</think>\n{"talent": []}') == {"talent": []}


def test_to_card_adds_meta_and_sources() -> None:
    result = to_card(
        parse_reply(REPLY),
        corp_code="01133217",
        name="카카오뱅크",
        talent_source="url",
        report_source="보고서",
    )
    assert result["prompt_version"] == PROMPT_VERSION
    assert all(t["source"] == "url" for t in result["talent"])
    assert all(d["source"] == "보고서" for d in result["direction"])


def test_verify_drops_talent_made_up_without_talent_source() -> None:
    # 실제 응답에서 모델은 인재상 원문이 없는데도 사업보고서 문장으로 인재상을 만들어 냈다
    llm = json.loads(REPLY)
    assert llm["talent"]
    kept, dropped = verify_card(
        llm, {"talent": "", "direction": " ".join(d["quote"] for d in llm["direction"])}
    )
    assert kept["talent"] == []
    assert len(kept["direction"]) == len(llm["direction"])
    assert {d["field"] for d in dropped} == {"talent"}


def test_verify_ignores_spacing_and_dot_variants_but_not_wording() -> None:
    source = "2025년 매출은 333조원이며 모바일ㆍ인터넷 사업에 집중합니다."
    card = {
        "direction": [
            {"summary": "띄어쓰기", "quote": "2025 년 매출은 333 조원이며"},
            {"summary": "가운뎃점", "quote": "모바일ᆞ인터넷 사업에 집중합니다."},
            {"summary": "지어냄", "quote": "모바일 사업을 축소합니다."},
        ]
    }
    kept, dropped = verify_card(card, {"direction": source})
    assert [d["summary"] for d in kept["direction"]] == ["띄어쓰기", "가운뎃점"]
    assert [d["summary"] for d in dropped] == ["지어냄"]


def test_normalize_empty_quote_is_dropped() -> None:
    kept, _ = verify_card({"talent": [{"keyword": "x", "quote": " "}]}, {"talent": "x"})
    assert kept["talent"] == []
    assert normalize(" a\tb\n") == "ab"


def test_market_input_keeps_company_position_sentences() -> None:
    business = (
        "당사의 2025년 DRAM 시장 점유율은 약 36% 수준으로 업계 1위를 유지하고 있습니다.\n"
        "당사는 2026년에 신규 공장을 가동할 계획입니다.\n"
        "당사는 경쟁사 대비 우수한 원가 경쟁력으로 환율 위험에 대응하고 있습니다.\n"
    )
    assert market_input(business) == (
        "당사의 2025년 DRAM 시장 점유율은 약 36% 수준으로 업계 1위를 유지하고 있습니다."
    )  # 계획 문장은 사업 방향 쪽, 환율(재무 위험) 문장은 뺀다


def test_verify_drops_summary_with_numbers_not_in_quote() -> None:
    # 실제 응답에서 모델이 인용에 없는 점유율·연차를 요약에 지어냈다
    source = "당사는 2006년 TV 판매 1위를 달성한 이후 20년 연속으로 1위를 지키고 있습니다."
    card = {
        "market": [
            {"summary": "TV 20년 연속 1위", "quote": source},
            {"summary": "TV 점유율 29%로 1위", "quote": source},
        ]
    }
    kept, dropped = verify_card(card, {"market": source})
    assert [m["summary"] for m in kept["market"]] == ["TV 20년 연속 1위"]
    assert [m["summary"] for m in dropped] == ["TV 점유율 29%로 1위"]


def test_link_articles_attaches_source_article() -> None:
    articles = [
        {
            "title": "카카오, AI 비전 인코더 공개",
            "summary": "오픈소스로 푼다.",
            "url": "u1",
            "published": "2026-10-21",
        },
        {
            "title": "카카오, 카나나 출시",
            "summary": "정식 출시했다.",
            "url": "u2",
            "published": "2026-10-20",
        },
    ]
    recent = [
        {"summary": "카나나 출시", "quote": "카카오,카나나 출시"},  # 띄어쓰기 차이는 무시
        {"summary": "지어냄", "quote": "카카오, 우주 진출"},
    ]
    linked = link_articles(recent, articles)
    assert [(r["summary"], r["source"], r["published"]) for r in linked] == [
        ("카나나 출시", "u2", "2026-10-20")
    ]


def test_news_input_one_line_per_event_biggest_first() -> None:
    def art(title: str, g: int) -> dict[str, object]:
        return {
            "title": title,
            "summary": "요약",
            "url": title,
            "published": "2026-10-21",
            "group": g,
        }

    text = news_input([art("버즈 온 출시", 0), art("ELB 펀드 출시", 1), art("ELB 펀드 첫선", 1)])
    assert text.split("\n")[::2] == [
        "[2026-10-21 · 기사 2건] ELB 펀드 출시",
        "[2026-10-21 · 기사 1건] 버즈 온 출시",
    ]


def test_link_articles_keeps_one_per_event() -> None:
    # 실제로 크래프톤 지스타 묶음(31건)에서 기사 두 개가 따로 뽑혔다
    def art(title: str, g: int) -> dict[str, object]:
        return {"title": title, "summary": "", "url": title, "published": "2026-10-21", "group": g}

    articles = [art("지스타 신작 기대", 0), art("지스타 5종 출품", 0), art("타래 시연", 1)]
    recent = [
        {"summary": s, "quote": s} for s in ("지스타 신작 기대", "지스타 5종 출품", "타래 시연")
    ]
    linked = link_articles(recent, articles)
    assert [(r["summary"], r["articles"]) for r in linked] == [
        ("지스타 신작 기대", 2),
        ("타래 시연", 1),
    ]


def test_news_input_keeps_biggest_events_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(card, "NEWS_EVENTS", 1)

    def art(title: str, g: int) -> dict[str, object]:
        return {
            "title": title,
            "summary": "요약",
            "url": title,
            "published": "2026-10-21",
            "group": g,
        }

    text = news_input([art("작은 이슈", 0), art("큰 이슈", 1), art("큰 이슈 후속", 1)])
    assert text == "[2026-10-21 · 기사 2건] 큰 이슈\n요약"
