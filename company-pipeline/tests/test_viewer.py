import http.server
import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from pipeline import viewer
from pipeline.candidates import Corp


@pytest.fixture
def base_url() -> Iterator[str]:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), viewer.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def _get(url: str) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(url, timeout=5) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_readonly_blocks_api_but_serves_page(
    base_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 서버는 companies.json이 배포 때 덮어써지고, 검색·AI 찾기가 우리 키로 DART·GMS를 부른다
    monkeypatch.setenv("VIEWER_READONLY", "1")

    assert json.loads(_get(f"{base_url}/api/mode")[1])["readonly"] is True
    assert _get(f"{base_url}/api/search?q=kakao")[0] == 403
    assert _get(f"{base_url}/api/ask?q=toss")[0] == 403
    assert _get(f"{base_url}/api/company?name=NAVER")[0] == 403
    assert _get(f"{base_url}/api/companies.json")[0] == 403
    for path, body in (
        ("/api/add", b'{"code": "00258801"}'),
        ("/api/update", b'{"name": "x"}'),
        ("/api/replace", b'{"rows": []}'),
    ):
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(urllib.request.Request(base_url + path, data=body), timeout=5)
        assert e.value.code == 403
    assert _get(f"{base_url}/viewer.html")[0] == 200


def _post(url: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    req = urllib.request.Request(url, data=json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_update_api_edits_existing_company(
    base_url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 화면의 '정보 수정': 이미 있는 회사의 인재상 칸만 고치고, 없는 회사는 404
    companies = tmp_path / "companies.json"
    companies.write_text(json.dumps([{"name": "NAVER", "talent_text": ""}]), encoding="utf-8")
    monkeypatch.setenv("COMPANIES_PATH", str(companies))
    monkeypatch.delenv("VIEWER_READONLY", raising=False)

    status, body = _post(f"{base_url}/api/update", {"name": "NAVER", "talent_url": "https://n"})
    assert status == 200 and body["updated"] == "NAVER"
    current = json.loads(_get(f"{base_url}/api/company?name=NAVER")[1])
    assert current["talent_url"] == "https://n"

    assert _post(f"{base_url}/api/update", {"name": "없는회사"})[0] == 404
    assert _get(f"{base_url}/api/company?name=x")[0] == 404


def test_replace_api_checks_then_replaces(
    base_url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    companies = tmp_path / "companies.json"
    companies.write_text(json.dumps([{"name": "NAVER"}]), encoding="utf-8")
    monkeypatch.setenv("COMPANIES_PATH", str(companies))
    monkeypatch.delenv("VIEWER_READONLY", raising=False)
    dart_names = [Corp("NAVER", "", "00266961", True), Corp("카카오", "", "00258801", True)]
    monkeypatch.setattr(viewer, "_corps", lambda: dart_names)
    rows = [{"name": "NAVER"}, {"name": "카카오"}]

    assert _get(f"{base_url}/api/companies.json")[1] == companies.read_bytes()  # 내려받기
    status, body = _post(f"{base_url}/api/replace", {"rows": rows, "dry_run": True})
    assert status == 200 and body["added"] == ["카카오"]
    assert len(json.loads(companies.read_text("utf-8"))) == 1  # 확인은 저장하지 않는다

    status, body = _post(f"{base_url}/api/replace", {"rows": [*rows, {"name": "없는회사"}]})
    assert status == 400 and body["errors"] == ["없는회사: DART 목록에 없는 회사명"]

    status, body = _post(f"{base_url}/api/replace", {"rows": rows})
    assert status == 200 and (tmp_path / str(body["backup"])).exists()
    assert [r["name"] for r in json.loads(companies.read_text("utf-8"))] == ["NAVER", "카카오"]


def test_responses_are_not_cached(base_url: str) -> None:
    # 매일 갱신되는 viewer_data.js를 Cloudflare·브라우저가 오래 저장해 두지 않게 한다
    with urllib.request.urlopen(f"{base_url}/viewer.html", timeout=5) as res:
        assert res.headers["Cache-Control"] == "no-cache"
    with urllib.request.urlopen(f"{base_url}/api/mode", timeout=5) as res:
        assert res.headers["Cache-Control"] == "no-cache"


def test_local_mode_is_not_readonly(base_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VIEWER_READONLY", raising=False)

    assert json.loads(_get(f"{base_url}/api/mode")[1])["readonly"] is False


def test_companies_status_marks_companies_without_card(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 방금 추가해 카드가 아직 없는 회사도 화면 목록에 "대기"로 보이게 한다
    companies = tmp_path / "companies.json"
    companies.write_text(json.dumps([{"name": "카카오"}, {"name": "DB"}]), encoding="utf-8")
    monkeypatch.setenv("COMPANIES_PATH", str(companies))
    (tmp_path / "cards").mkdir()
    (tmp_path / "cards" / "00258801.json").write_text(
        json.dumps({"name": "카카오"}), encoding="utf-8"
    )

    assert viewer.companies_status(tmp_path) == [
        {"name": "카카오", "has_card": True},
        {"name": "DB", "has_card": False},
    ]


def test_companies_api_works_in_readonly(base_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # 키를 쓰지 않는 목록 조회라 읽기 전용에서도 연다
    monkeypatch.setenv("VIEWER_READONLY", "1")
    assert _get(f"{base_url}/api/companies")[0] == 200
