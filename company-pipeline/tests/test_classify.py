import json
from pathlib import Path
from typing import Any

import pytest
from company_taxonomy.ncs import NCS_SUBCATEGORIES
from company_taxonomy.talent_criteria import TALENT_CRITERIA

from pipeline import card, classify, run

TALENT: list[dict[str, Any]] = [
    {"title": "도전", "parent": None, "details": ["끊임없이 도전한다"], "source": "url"},
    {"title": "협업", "parent": "일하는 방식", "details": [], "source": "url"},
]


def _reply(*items: dict[str, Any]) -> Any:
    calls: list[list[dict[str, str]]] = []

    def fake(messages: list[dict[str, str]], model: str | None = None) -> dict[str, Any]:
        calls.append(messages)
        return {"items": list(items)}

    fake.calls = calls  # type: ignore[attr-defined]
    return fake


def test_system_lists_every_talent_criterion() -> None:
    assert all(name in classify.CRITERION_SYSTEM for name, _ in TALENT_CRITERIA)


def test_add_criteria_adds_criterion_names(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _reply({"no": 1, "criterion": "도전·혁신"}, {"no": 2, "criterion": "협력·소통"})
    monkeypatch.setattr(card, "call_llm", fake)

    result = classify.add_criteria("테스트", TALENT)

    assert [t["criterion"] for t in result] == ["도전·혁신", "협력·소통"]
    assert result[0]["title"] == "도전"  # 다른 칸은 그대로
    assert "일하는 방식 / 협업" in fake.calls[0][1]["content"]


def test_add_criteria_uses_talent_model(monkeypatch: pytest.MonkeyPatch) -> None:
    models: list[str | None] = []

    def fake(messages: list[dict[str, str]], model: str | None = None) -> dict[str, Any]:
        models.append(model)
        return {"items": []}

    monkeypatch.setattr(card, "call_llm", fake)
    monkeypatch.setenv("TALENT_LLM_MODEL", "strong-model")

    classify.add_criteria("테스트", TALENT)

    assert models == ["strong-model"]


def test_add_criteria_leaves_unknown_or_missing_names_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 목록에 없는 이름과 bool 번호는 사용하지 않고, 응답에 없는 항목은 분류값 없이 남긴다
    fake = _reply({"no": 1, "criterion": "열정"}, {"no": True, "criterion": "도전·혁신"})
    monkeypatch.setattr(card, "call_llm", fake)

    result = classify.add_criteria("테스트", TALENT)

    assert all("criterion" not in t for t in result)


@pytest.mark.parametrize("reply", [{}, {"items": None}, {"items": ["도전·혁신"]}])
def test_add_criteria_leaves_items_empty_on_malformed_reply(
    monkeypatch: pytest.MonkeyPatch, reply: dict[str, Any]
) -> None:
    monkeypatch.setattr(card, "call_llm", lambda messages, model=None: reply)

    assert classify.add_criteria("테스트", TALENT) == TALENT


def test_add_criteria_keeps_card_when_call_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(messages: list[dict[str, str]], model: str | None = None) -> dict[str, Any]:
        raise TimeoutError("timed out")

    monkeypatch.setattr(card, "call_llm", broken)

    assert classify.add_criteria("테스트", TALENT) == TALENT


def test_add_criteria_sends_only_items_without_criterion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    done = {**TALENT[0], "criterion": "실행·성과"}
    fake = _reply({"no": 1, "criterion": "협력·소통"})
    monkeypatch.setattr(card, "call_llm", fake)

    result = classify.add_criteria("테스트", [done, TALENT[1]])

    assert [t["criterion"] for t in result] == ["실행·성과", "협력·소통"]
    sent = fake.calls[0][1]["content"]
    assert "협업" in sent and "도전" not in sent


def test_add_criteria_skips_call_when_every_item_has_criterion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _reply()
    monkeypatch.setattr(card, "call_llm", fake)
    done = [{**t, "criterion": "실행·성과"} for t in TALENT]

    assert classify.add_criteria("테스트", done) == done
    assert classify.add_criteria("테스트", []) == []
    assert fake.calls == []


def test_add_criteria_reads_old_keyword_format(monkeypatch: pytest.MonkeyPatch) -> None:
    # card-v8 이전 카드의 인재상은 keyword·quote 형식이다
    fake = _reply({"no": 1, "criterion": "협력·소통"})
    monkeypatch.setattr(card, "call_llm", fake)
    old = [{"keyword": "협업", "quote": "우리는 함께 일합니다.", "source": "url"}]

    result = classify.add_criteria("테스트", old)

    assert result[0]["criterion"] == "협력·소통"
    assert "협업 / 우리는 함께 일합니다." in fake.calls[0][1]["content"]


def _write_card(data: Path, code: str, talent: list[dict[str, Any]]) -> Path:
    saved = {
        "corp_code": code,
        "name": f"회사{code}",
        "generated_at": "2026-10-30",
        "prompt_version": "card-v9",
        "talent": talent,
        "direction": [],
        "market": [],
        "recent": [],
    }
    path = data / "cards" / f"{code}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
    return path


def test_fill_classification_fills_only_cards_with_missing_criterion(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    empty = _write_card(tmp_path, "00000001", [TALENT[0]])
    done = _write_card(tmp_path, "00000002", [{**TALENT[1], "criterion": "협력·소통"}])
    no_talent = _write_card(tmp_path, "00000003", [])
    before = done.read_text(encoding="utf-8")
    fake = _reply({"no": 1, "criterion": "도전·혁신"})
    monkeypatch.setattr(card, "call_llm", fake)

    saved = run.fill_classification(tmp_path)

    assert saved == [empty]
    assert len(fake.calls) == 1
    filled = json.loads(empty.read_text(encoding="utf-8"))
    assert filled["talent"][0]["criterion"] == "도전·혁신"
    # 분류값만 채우고 카드를 만든 버전·날짜는 변경하지 않는다
    assert (filled["prompt_version"], filled["generated_at"]) == ("card-v9", "2026-10-30")
    assert done.read_text(encoding="utf-8") == before
    assert json.loads(no_talent.read_text(encoding="utf-8"))["talent"] == []


def test_fill_classification_skips_card_when_nothing_is_filled(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = _write_card(tmp_path, "00000001", [TALENT[0]])
    before = path.read_text(encoding="utf-8")
    monkeypatch.setattr(card, "call_llm", _reply({"no": 1, "criterion": "열정"}))

    assert run.fill_classification(tmp_path) == []
    assert path.read_text(encoding="utf-8") == before


DIRECTION = {
    "summary": "AI 인프라 확대",
    "quote": "AI 인프라 사업에 집중할 계획",
    "source": "보고서",
}
MARKET = [
    {"summary": "국내 점유율 1위", "quote": "국내 점유율 1위", "source": "보고서"},
    {"summary": "주요 고객 공공기관", "quote": "주요 고객은 공공기관", "source": "보고서"},
]


def test_ncs_list_has_72_unique_names_and_system_lists_them() -> None:
    assert len(set(NCS_SUBCATEGORIES)) == len(NCS_SUBCATEGORIES) == 72
    assert all(name in classify.SUBCATEGORY_SYSTEM for name in NCS_SUBCATEGORIES)


def test_add_subcategories_classifies_sections_in_one_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _reply(
        {"no": 1, "ncs_subcategories": ["IT시스템관리", "클라우드솔루션아키텍처"]},
        {"no": 2, "ncs_subcategories": []},
        {"no": 3, "ncs_subcategories": ["IT마케팅"]},
    )
    monkeypatch.setattr(card, "call_llm", fake)

    result = classify.add_subcategories("테스트", {"direction": [DIRECTION], "market": MARKET})

    assert len(fake.calls) == 1
    assert [d["ncs_subcategories"] for d in result["direction"]] == [
        ["IT시스템관리", "클라우드솔루션아키텍처"]
    ]
    # 해당하는 세분류가 없다는 빈 목록도 분류값으로 저장한다
    assert [m["ncs_subcategories"] for m in result["market"]] == [[], ["IT마케팅"]]
    assert "AI 인프라 확대 / AI 인프라 사업에 집중할 계획" in fake.calls[0][1]["content"]


@pytest.mark.parametrize(
    "value",
    [
        ["클라우드"],  # 목록에 없는 이름
        ["IT시스템관리", "IT기술지원", "IT기술교육", "IT감리"],  # 4개
        ["IT시스템관리", "IT시스템관리"],  # 중복
        {"IT시스템관리": "SW아키텍처"},  # 목록이 아닌 객체
    ],
)
def test_add_subcategories_leaves_invalid_values_empty(
    monkeypatch: pytest.MonkeyPatch, value: Any
) -> None:
    monkeypatch.setattr(card, "call_llm", _reply({"no": 1, "ncs_subcategories": value}))

    result = classify.add_subcategories("테스트", {"direction": [DIRECTION]})

    assert result == {"direction": [DIRECTION]}


def test_fill_classification_fills_missing_subcategories_only(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = _write_card(tmp_path, "00000001", [])
    saved_card = json.loads(path.read_text(encoding="utf-8"))
    done = {**MARKET[0], "ncs_subcategories": ["IT마케팅"]}
    recent = {"summary": "신제품 출시", "quote": "신제품 출시", "source": "u1"}
    saved_card.update(direction=[DIRECTION], market=[done], recent=[recent])
    path.write_text(json.dumps(saved_card, ensure_ascii=False), encoding="utf-8")
    fake = _reply(
        {"no": 1, "ncs_subcategories": ["SW아키텍처"]}, {"no": 2, "ncs_subcategories": []}
    )
    monkeypatch.setattr(card, "call_llm", fake)

    assert run.fill_classification(tmp_path) == [path]

    filled = json.loads(path.read_text(encoding="utf-8"))
    assert filled["direction"][0]["ncs_subcategories"] == ["SW아키텍처"]
    assert filled["market"] == [done]  # 이미 분류된 항목은 전송하지 않고 유지한다
    assert filled["recent"][0]["ncs_subcategories"] == []
    sent = fake.calls[0][1]["content"]
    assert "AI 인프라 확대" in sent and "국내 점유율 1위" not in sent
