import json
from pathlib import Path
from typing import Any

import pytest

from pipeline import card, dart, run

REPORT = """<TITLE AASSOCNOTE="D-0-2-0-0">II. 사업의 내용</TITLE>
<P>1. 사업의 개요</P><P>당사는 AI 인프라 사업에 더욱 집중할 계획입니다.</P>
<P>2. 주요 제품 및 서비스</P><P>서버</P>
<TITLE AASSOCNOTE="D-0-3-0-0">III. 재무에 관한 사항</TITLE>"""


@pytest.fixture
def fake_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dart, "fetch_report", lambda name, raw: ("00000001", REPORT))


def _fake_llm(reply: dict[str, Any]) -> Any:
    return lambda messages: reply


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
    (tmp_path / "news").mkdir()
    article = {
        "title": "테스트, 신제품 출시",
        "summary": "출시했다.",
        "url": "u1",
        "published": "2026-10-21",
        "group": 0,
    }
    (tmp_path / "news" / "테스트.json").write_text(
        json.dumps({"items": [article]}, ensure_ascii=False), "utf-8"
    )
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
