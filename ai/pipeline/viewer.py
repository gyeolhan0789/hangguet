"""확인용 화면(viewer.html)이 읽을 데이터를 만든다.

브라우저는 file://에서 JSON을 fetch할 수 없어서, 카드와 근거 원문을 data/viewer_data.js로 묶는다.

cd ai && uv run python -m pipeline.viewer   # 데이터를 만들고 로컬 서버를 띄워 브라우저로 연다
"""

import contextlib
import functools
import http.server
import json
import webbrowser
from pathlib import Path
from typing import Any

from pipeline import card, dart, extract, news

HERE = Path(__file__).parent
DATA = HERE / "data"


def build(data: Path = DATA, companies: Path = HERE / "companies.json") -> list[dict[str, Any]]:
    """카드마다 그 카드가 근거로 쓴 원문(인재상, 사업보고서 입력)을 붙인다."""
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


def serve(port: int = 8765) -> None:
    """pipeline 폴더를 이 컴퓨터에서만 접속되는 주소로 띄운다. Ctrl+C로 끈다."""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(HERE))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        url = f"http://127.0.0.1:{port}/viewer.html"
        print(f"{url} 열림 (끄려면 Ctrl+C)")
        webbrowser.open(url)
        with contextlib.suppress(KeyboardInterrupt):
            server.serve_forever()


if __name__ == "__main__":
    print(write())
    serve()
