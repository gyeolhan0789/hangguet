import json
from pathlib import Path

from pipeline.card import PROMPT_VERSION, build_messages, business_input, parse_reply, to_card
from pipeline.verify import normalize, verify_card

FIXTURES = Path(__file__).parent / "fixtures"
# 2026-10-19 로컬 qwen3:8b가 카카오뱅크 자료로 만든 실제 응답 (인재상 원문은 비워서 보냄)
REPLY = (FIXTURES / "llm_reply_kakaobank.json").read_text(encoding="utf-8")

# 하위 항목 번호가 '1.'부터 다시 매겨지는 실제 사업보고서 구조를 줄인 샘플
BUSINESS = """II. 사업의 내용
1. 사업의 개요
당사는 메모리 반도체 기업입니다.
2. 주요 제품 및 서비스
DRAM
6. 주요계약 및 연구개발활동
1. 연구개발 담당조직
7. 기타 참고사항
1. 산업의 특성
AI 인프라 확장으로 고대역폭 메모리 수요가 늘고 있습니다.
2. 산업의 성장성
"""


def test_business_input_keeps_overview_and_whole_other_section() -> None:
    text = business_input(BUSINESS)
    assert text.startswith("1. 사업의 개요")
    assert "메모리 반도체 기업" in text
    assert "DRAM" not in text  # 2~6은 뺀다
    assert "고대역폭 메모리 수요" in text  # '7.' 안의 '1. 산업의 특성'에서 끊기지 않음


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
