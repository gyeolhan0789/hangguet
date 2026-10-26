import http.server
import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator

import pytest

from pipeline import viewer


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

    assert _get(f"{base_url}/api/mode") == (200, json.dumps({"readonly": True}).encode())
    assert _get(f"{base_url}/api/search?q=kakao")[0] == 403
    assert _get(f"{base_url}/api/ask?q=toss")[0] == 403
    add = urllib.request.Request(f"{base_url}/api/add", data=b'{"code": "00258801"}')
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(add, timeout=5)
    assert e.value.code == 403
    assert _get(f"{base_url}/viewer.html")[0] == 200


def test_responses_are_not_cached(base_url: str) -> None:
    # 매일 갱신되는 viewer_data.js를 Cloudflare·브라우저가 오래 저장해 두지 않게 한다
    with urllib.request.urlopen(f"{base_url}/viewer.html", timeout=5) as res:
        assert res.headers["Cache-Control"] == "no-cache"
    with urllib.request.urlopen(f"{base_url}/api/mode", timeout=5) as res:
        assert res.headers["Cache-Control"] == "no-cache"


def test_local_mode_is_not_readonly(base_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VIEWER_READONLY", raising=False)

    assert _get(f"{base_url}/api/mode") == (200, json.dumps({"readonly": False}).encode())
