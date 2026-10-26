"""확인용 화면(viewer.html)이 읽을 데이터를 만든다.

브라우저는 file://에서 JSON을 fetch할 수 없어서, 카드와 근거 원문을 data/viewer_data.js로 묶는다.

cd company-pipeline && uv run --env-file .env python -m pipeline.viewer   # 데이터 만들고 화면 띄움
화면의 '회사 추가'는 DART 목록에서 고른 회사만 companies.json에 넣는다(DART·GMS 키 필요)

서버(compose의 viewer 컨테이너)는 회사 목록을 COMPANIES_PATH(배포 때 덮어쓰지 않는 data/ 아래)에
둬서 화면에서 추가한 회사가 남는다. 바깥 공개는 Cloudflare Access(허용 이메일만) 뒤에서만 한다.
VIEWER_READONLY=1이면 /api/*를 모두 막고 화면만 보여 준다(회사 추가를 막아야 할 때)
VIEWER_HOST는 여는 주소(기본 127.0.0.1, 컨테이너 안에서는 0.0.0.0)
"""

import contextlib
import functools
import http.server
import json
import os
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Any

from pipeline import candidates, card, dart, extract, news

HERE = Path(__file__).parent
DATA = HERE / "data"


def build(data: Path = DATA, companies: Path | None = None) -> list[dict[str, Any]]:
    """카드마다 그 카드가 근거로 쓴 원문(인재상, 사업보고서 입력)을 붙인다."""
    companies = companies or candidates.companies_file()
    talents = {c["name"]: c for c in json.loads(companies.read_text(encoding="utf-8"))}
    rows = []
    for path in sorted((data / "cards").glob("*.json")):
        item = json.loads(path.read_text(encoding="utf-8"))
        report = dart.latest_report(item["corp_code"])
        business = market = ""
        if report:
            section = extract.business_section(report)
            business, market = card.business_input(section), card.market_input(section)
        company = talents.get(item["name"], {})
        rows.append(
            {
                "card": item,
                "talent_text": company.get("talent_text", ""),
                "talent_collected_at": company.get("talent_collected_at", ""),
                "business_text": business,
                "market_text": market,
                "news_text": card.news_input(news.load(item["corp_code"])),
            }
        )
    return rows


def write(data: Path = DATA) -> Path:
    out = data / "viewer_data.js"
    payload = json.dumps(build(data), ensure_ascii=False)
    out.write_text(f"window.VIEWER_DATA = {payload};\n", encoding="utf-8")
    return out


@functools.cache
def _corps() -> list[candidates.Corp]:
    """DART 고유번호 목록(약 11만 개). 첫 검색 때 한 번 읽는다."""
    return candidates.corps(dart.corpcode_xml())


def _registered() -> set[str]:
    rows = json.loads(candidates.companies_file().read_text(encoding="utf-8"))
    return {r["name"] for r in rows}


def _corp_json(corp: candidates.Corp) -> dict[str, Any]:
    return {
        "name": corp.name,
        "eng": corp.eng,
        "code": corp.code,
        "listed": corp.listed,
        "registered": corp.name in _registered(),
    }


def companies_status(data: Path = DATA) -> list[dict[str, Any]]:
    """회사 목록의 회사마다 카드가 있는지. 화면이 카드 없는(대기 중인) 회사도 목록에 보여 준다."""
    rows = json.loads(candidates.companies_file().read_text(encoding="utf-8"))
    cards = {
        json.loads(p.read_text(encoding="utf-8"))["name"] for p in (data / "cards").glob("*.json")
    }
    return [{"name": r["name"], "has_card": r["name"] in cards} for r in rows]


def _readonly() -> bool:
    return os.environ.get("VIEWER_READONLY") == "1"


def _has_report(code: str) -> bool:
    try:
        dart.annual_report_no(code)
    except (LookupError, RuntimeError):
        return False
    return True


class Handler(http.server.SimpleHTTPRequestHandler):
    """pipeline 폴더 파일 + 회사 추가 화면용 API (DART 목록에 있는 회사만 추가)."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(HERE), **kwargs)

    def end_headers(self) -> None:
        # 매일 작업이 viewer_data.js를 덮어쓰는데, Cloudflare·브라우저가 .js를 몇 시간 저장해 두면
        # 갱신된 카드가 늦게 보인다. 매번 서버에 확인하게 한다(바뀌지 않았으면 304라 가볍다)
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _send(self, status: int, body: Any) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _by_code(self, code: str) -> candidates.Corp | None:
        return next((c for c in _corps() if c.code == code), None)

    def do_GET(self) -> None:  # noqa: N802 (http.server 이름)
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        arg = q.get("q", q.get("code", [""]))[0]
        if url.path == "/api/mode":  # 화면이 회사 추가 버튼·안내 문구를 정한다
            self._send(
                200, {"readonly": _readonly(), "server": bool(os.environ.get("COMPANIES_PATH"))}
            )
        elif url.path == "/api/companies":  # 카드가 아직 없는 회사도 목록에 보이게 (키를 쓰지 않음)
            self._send(200, companies_status())
        elif url.path.startswith("/api/") and _readonly():
            self._send(403, {"error": "읽기 전용 화면"})
        elif url.path == "/api/search":  # 자동완성
            self._send(200, [_corp_json(c) for c in candidates.search(arg, _corps())])
        elif url.path == "/api/ask":  # 약칭은 AI로 정식명 찾기 (DART 목록에 있을 때만)
            corp = candidates.ask_official(arg, _corps())
            self._send(200, _corp_json(corp) if corp else None)
        elif url.path == "/api/check":  # 고른 회사: 최근 1년 사업보고서가 있는지
            corp = self._by_code(arg)
            if corp is None:
                self._send(404, {"error": "DART 목록에 없는 고유번호"})
            else:
                self._send(200, _corp_json(corp) | {"report": _has_report(corp.code)})
        else:
            super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if _readonly():
            self._send(403, {"error": "읽기 전용 화면"})
            return
        if urllib.parse.urlparse(self.path).path != "/api/add":
            self._send(404, {"error": "없는 주소"})
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        corp = self._by_code(str(body.get("code", "")))
        if corp is None:
            self._send(400, {"error": "DART 목록에 있는 회사만 추가할 수 있다"})
            return
        try:  # 사업보고서가 없어도 인재상·최근 이슈만 있는 부분 카드로 추가한다
            candidates.add(corp, {k: str(v) for k, v in body.items()})
        except ValueError as e:
            self._send(409, {"error": str(e)})
            return
        self._send(200, {"added": corp.name, "report": _has_report(corp.code)})


def serve(port: int = 8765) -> None:
    """pipeline 폴더를 이 컴퓨터에서만 접속되는 주소로 띄운다. Ctrl+C로 끈다."""
    host = os.environ.get("VIEWER_HOST", "127.0.0.1")
    with http.server.ThreadingHTTPServer((host, port), Handler) as server:
        url = f"http://127.0.0.1:{port}/viewer.html"
        print(f"{url} 열림 (끄려면 Ctrl+C){' 읽기 전용' if _readonly() else ''}", flush=True)
        if not _readonly():  # 서버에는 브라우저가 없다
            webbrowser.open(url)
        with contextlib.suppress(KeyboardInterrupt):
            server.serve_forever()


if __name__ == "__main__":
    print(write())
    serve()
