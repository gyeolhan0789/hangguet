import json
from pathlib import Path
from typing import Any

import pytest

from pipeline import card, dart, run, storage

REPORT = """<TITLE AASSOCNOTE="D-0-2-0-0">II. 사업의 내용</TITLE>
<P>1. 사업의 개요</P><P>당사는 AI 인프라 사업에 더욱 집중할 계획입니다.</P>
<P>2. 주요 제품 및 서비스</P><P>서버</P>
<TITLE AASSOCNOTE="D-0-3-0-0">III. 재무에 관한 사항</TITLE>"""


@pytest.fixture
def fake_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dart, "fetch_report", lambda name: ("00000001", REPORT))


def _fake_llm(reply: dict[str, Any]) -> Any:
    return lambda messages, model=None: reply


def test_build_one_writes_card_and_drops_made_up_quotes(
    fake_sources: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    reply = {
        "talent": [{"keyword": "협업", "quote": "우리는 협업합니다."}],
        "direction": [
            {"summary": "AI 인프라", "quote": "당사는 AI 인프라 사업에 더욱 집중할 계획입니다."},
            {"summary": "지어냄", "quote": "당사는 우주 사업에 진출합니다."},
        ],
    }
    monkeypatch.setattr(card, "call_llm", _fake_llm(reply))
    company = {"name": "테스트", "talent_url": "url", "talent_text": ""}

    out = run.build_one(company, tmp_path)

    saved = json.loads(out.read_text(encoding="utf-8"))
    assert out == tmp_path / "cards" / "00000001.json"
    assert saved["talent"] == []  # 인재상 원문이 없으니 버림
    assert [d["summary"] for d in saved["direction"]] == ["AI 인프라"]


def test_build_one_asks_talent_and_direction_separately(
    fake_sources: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[tuple[str, str | None]] = []

    def fake(messages: list[dict[str, str]], model: str | None = None) -> dict[str, Any]:
        calls.append((messages[0]["content"], model))
        if messages[0]["content"] == card.TALENT_SYSTEM:
            return {"items": [{"title": "협업", "parent": None, "details": ["우리는 협업합니다."]}]}
        return {"direction": [{"summary": "AI 인프라", "quote": "AI 인프라 사업에 더욱 집중할"}]}

    monkeypatch.setattr(card, "call_llm", fake)
    monkeypatch.setenv("TALENT_LLM_MODEL", "strong-model")
    company = {"name": "테스트", "talent_url": "url", "talent_text": "협업\n우리는 협업합니다."}

    saved = json.loads(run.build_one(company, tmp_path).read_text(encoding="utf-8"))

    # 인재상만 TALENT_LLM_MODEL로, 사업 방향은 기본 모델(LLM_MODEL)로 부른다
    assert calls == [(card.TALENT_SYSTEM, "strong-model"), (card.DIRECTION_SYSTEM, None)]
    assert saved["talent_model"] == "strong-model"
    talent = [(t["title"], t["details"]) for t in saved["talent"]]
    assert talent == [("협업", ["우리는 협업합니다."])]
    assert [d["summary"] for d in saved["direction"]] == ["AI 인프라"]


def test_build_one_keeps_every_listed_talent(
    fake_sources: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # 삼성증권처럼 원칙 7개를 나열한 인재상은 3개로 자르지 않고 모두 남긴다
    principles = [f"우리는 원칙 {n}을 지킵니다." for n in range(1, 8)]
    reply: dict[str, Any] = {
        "items": [{"title": p, "parent": None, "details": []} for p in principles]
    }
    monkeypatch.setattr(card, "call_llm", _fake_llm(reply))
    company = {"name": "테스트", "talent_url": "url", "talent_text": "\n".join(principles)}

    saved = json.loads(run.build_one(company, tmp_path).read_text(encoding="utf-8"))

    assert len(saved["talent"]) == 7


def test_build_one_fails_when_nothing_passes(
    fake_sources: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    reply = {"talent": [], "direction": [{"summary": "x", "quote": "원문에 없음"}]}
    monkeypatch.setattr(card, "call_llm", _fake_llm(reply))

    with pytest.raises(ValueError):
        run.build_one({"name": "테스트"}, tmp_path)
    assert not (tmp_path / "cards").exists()


def test_refresh_recent_replaces_only_recent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    old = {
        "corp_code": "00000001",
        "name": "테스트",
        "generated_at": "2026-10-01",
        "talent": [{"keyword": "협업", "quote": "우리는 협업합니다.", "source": "url"}],
        "direction": [],
        "market": [],
        "recent": [{"summary": "지난 이슈", "quote": "옛 기사", "source": "old"}],
    }
    (tmp_path / "cards").mkdir()
    (tmp_path / "cards" / "00000001.json").write_text(json.dumps(old, ensure_ascii=False), "utf-8")
    article = {
        "title": "테스트, 신제품 출시",
        "summary": "출시했다.",
        "url": "u1",
        "published": "2026-10-21",
        "group": 0,
    }
    storage.put("processed/news/00000001.json", json.dumps({"items": [article]}).encode())
    reply = {"recent": [{"summary": "신제품 출시", "quote": "테스트, 신제품 출시"}]}
    monkeypatch.setattr(card, "call_llm", _fake_llm(reply))

    out = run.refresh_recent({"name": "테스트"}, tmp_path)

    saved = json.loads(out.read_text(encoding="utf-8"))
    assert saved["talent"] == old["talent"]  # 최근 이슈 말고는 그대로
    assert [(r["summary"], r["source"]) for r in saved["recent"]] == [("신제품 출시", "u1")]


def test_refresh_recent_builds_whole_card_when_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(run, "build_one", lambda company, data: data / "built")
    assert run.refresh_recent({"name": "새회사"}, tmp_path) == tmp_path / "built"


def test_build_one_keeps_card_when_recent_issues_fail(
    fake_sources: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    reply = {
        "talent": [],
        "direction": [
            {"summary": "AI 인프라", "quote": "당사는 AI 인프라 사업에 더욱 집중할 계획입니다."}
        ],
    }
    monkeypatch.setattr(card, "call_llm", _fake_llm(reply))

    def broken(name: str, code: str) -> list[dict[str, str]]:
        raise TimeoutError("timed out")  # 모델이 반복하다 시간 초과

    monkeypatch.setattr(run, "recent_issues", broken)

    saved = json.loads(run.build_one({"name": "테스트"}, tmp_path).read_text(encoding="utf-8"))
    assert [d["summary"] for d in saved["direction"]] == ["AI 인프라"]
    assert saved["recent"] == []


def test_build_one_partial_card_without_annual_report(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # 코스콤처럼 사업보고서 없이 감사보고서만 내는 비상장사
    def no_report(name: str) -> tuple[str, str]:
        raise LookupError("최근 1년 안에 사업보고서가 없다")

    monkeypatch.setattr(dart, "fetch_report", no_report)
    monkeypatch.setattr(dart, "corp_code", lambda name: "00000002")
    reply: dict[str, Any] = {
        "items": [{"title": "우리는 도전합니다.", "parent": None, "details": []}]
    }
    monkeypatch.setattr(card, "call_llm", _fake_llm(reply))
    company = {"name": "비상장", "talent_url": "url", "talent_text": "우리는 도전합니다."}

    saved = json.loads(run.build_one(company, tmp_path).read_text(encoding="utf-8"))
    assert [t["title"] for t in saved["talent"]] == ["우리는 도전합니다."]
    assert saved["direction"] == [] and saved["market"] == []
