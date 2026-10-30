import hashlib
import json
from pathlib import Path

import pytest

from pipeline import publish
from pipeline.candidates import Corp

SDS = Corp("삼성에스디에스", "Samsung SDS Co., Ltd.", "00126186", True)
COMPANIES = [
    {"name": "삼성에스디에스", "news_query": "삼성SDS", "aliases": "SDS, 삼성 에스디에스"},
    {"name": "대기중"},  # 카드가 아직 없는 회사
]


def _card(data: Path, code: str, name: str) -> bytes:
    body = json.dumps(
        {"corp_code": code, "name": name, "generated_at": "2026-10-30", "talent": []},
        ensure_ascii=False,
    ).encode("utf-8")
    (data / "cards").mkdir(parents=True, exist_ok=True)
    (data / "cards" / f"{code}.json").write_bytes(body)
    return body


def test_aliases_normalized_and_deduplicated() -> None:
    # 회사명·영문명·기사 검색어·별칭 칸을 candidates.key 규칙으로 맞추고 겹치는 이름은 한 번만
    assert publish.aliases(COMPANIES[0], SDS) == ["삼성에스디에스", "samsungsds", "삼성sds", "sds"]
    assert publish.aliases({"name": "(주)카카오"}, None) == ["카카오"]


def test_build_lists_only_companies_with_cards(tmp_path: Path) -> None:
    body = _card(tmp_path, "00126186", "삼성에스디에스")
    _card(tmp_path, "00000009", "목록에서뺀회사")  # 카드는 남아 있어도 올리지 않는다
    digest = hashlib.sha256(body).hexdigest()

    manifest, uploads = publish.build(tmp_path, COMPANIES, {SDS.code: SDS})

    assert manifest["format"] == 1
    assert manifest["companies"] == [
        {
            "corp_code": "00126186",
            "name": "삼성에스디에스",
            "is_listed": True,
            "aliases": ["삼성에스디에스", "samsungsds", "삼성sds", "sds"],
            "generated_at": "2026-10-30",
            "card_key": f"cards/00126186/{digest}.json",
            "sha256": digest,
        }
    ]
    assert uploads == {f"cards/00126186/{digest}.json": body}  # 올린 그대로의 내용으로 해시


def test_publish_writes_cards_then_manifest_locally(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("CARD_S3_BUCKET", raising=False)
    body = _card(tmp_path, "00126186", "삼성에스디에스")

    out = publish.publish(tmp_path, COMPANIES, {SDS.code: SDS})

    assert out == str(tmp_path / "publish" / "manifest.json")
    manifest = json.loads(Path(out).read_text(encoding="utf-8"))
    card_key = manifest["companies"][0]["card_key"]
    assert (tmp_path / "publish" / card_key).read_bytes() == body


def test_publish_refuses_empty_manifest(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        publish.publish(tmp_path, COMPANIES, {})
