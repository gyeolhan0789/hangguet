"""⑤ 뉴스 수집: 네이버 뉴스 검색 API로 회사별 최근 기사의 제목·요약·링크를 모은다.

저작권 때문에 기사 본문은 받지 않는다. API가 주는 제목과 요약(1~2문장)만 쓴다.
"""

import html
import json
import math
import os
import re
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

API = "https://openapi.naver.com/v1/search/news.json"
DAYS = 30
# bge-m3 제목 유사도: 같은 사건 0.62~0.95, 다른 사건은 0.65 언저리부터 섞임. 0.70과 비교해 보니
# 0.65가 같은 사건을 덜 나누고 묶음 안에 다른 사건도 없었다(2026-10-21, 10곳)
SAME_EVENT = 0.65
# 회사 이야기가 아닌 기사: 주가·시황, 증권사(현대차증권 등 다른 회사·애널리스트), 광고·이벤트·퀴즈.
# '코스피'는 뺐다: "코스피200 연계 펀드 출시" 같은 상품 기사까지 버려졌다
_NOISE = re.compile(
    r"주가|목표가|특징주|증시|순매수|순매도|급등|급락|반등|상한가|하한가|52주|시총|\d+%대|\w증권"
    # '↑'만으로는 "전력 효율성↑" 같은 기사도 걸려서 숫자%↑만. 證은 "KB證"처럼 증권사 한자 표기
    r"|\d%[↑↓]|(상승|하락) 출발|동반 (상승|하락)|핫스탁|證"
    r"|이벤트|할인|경품|증정|프로모션|퀴즈|정답|\[포토\]|\[인사\]|\[부고\]"
)


def _get(query: str) -> dict[str, Any]:
    # 최신순(date)은 큰 회사면 100건이 한두 시간 기사로 다 차서, 관련도순(sim)으로 받는다
    params = urllib.parse.urlencode({"query": query, "display": 100, "sort": "sim"})
    req = urllib.request.Request(
        f"{API}?{params}",
        headers={
            "X-Naver-Client-Id": os.environ["NAVER_CLIENT_ID"],
            "X-Naver-Client-Secret": os.environ["NAVER_CLIENT_SECRET"],
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        result: dict[str, Any] = json.loads(res.read())
    return result


def _text(markup: str) -> str:
    """API가 검색어를 <b>로 감싸고 따옴표 등을 &quot;로 준다."""
    return html.unescape(re.sub(r"</?b>", "", markup)).strip()


def select(
    response: dict[str, Any], query: str, today: date, days: int = DAYS
) -> list[dict[str, str]]:
    """최근 days일 기사 중 제목에 회사 이름이 있고 시황·광고가 아닌 것만. 같은 제목은 하나만."""
    since = today - timedelta(days=days)
    picked: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in response.get("items", []):
        title, summary = _text(item["title"]), _text(item["description"])
        published = parsedate_to_datetime(item["pubDate"]).date()
        key = re.sub(r"\W", "", title)
        if published < since or query not in title or _NOISE.search(title) or key in seen:
            continue
        seen.add(key)
        picked.append(
            {
                "title": title,
                "summary": summary,
                "url": item.get("originallink") or item["link"],
                "published": published.isoformat(),
            }
        )
    return picked


def merge(
    old: list[dict[str, str]], new: list[dict[str, str]], today: date, days: int = DAYS
) -> list[dict[str, str]]:
    """한 번에 2~3일치만 잡혀서 전에 모은 기사에 쌓는다. 같은 제목은 새 것으로, 오래된 건 버림."""
    since = (today - timedelta(days=days)).isoformat()
    by_title = {re.sub(r"\W", "", i["title"]): i for i in old + new if i["published"] >= since}
    return sorted(by_title.values(), key=lambda i: i["published"], reverse=True)


def embed(texts: list[str]) -> list[list[float]]:
    """OpenAI 호환 embeddings 호출. 기본은 로컬 Ollama의 bge-m3(한국어 지원)."""
    payload = {"model": os.environ.get("EMBED_MODEL", "bge-m3"), "input": texts}
    req = urllib.request.Request(
        os.environ.get("EMBED_URL", "http://localhost:11434/v1/embeddings"),
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as res:
        return [d["embedding"] for d in json.loads(res.read())["data"]]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    return dot / math.sqrt(sum(x * x for x in a) * sum(y * y for y in b))


def group(vectors: list[list[float]], threshold: float = SAME_EVENT) -> list[int]:
    """기사마다 묶음 번호. 앞선 묶음의 첫 기사와 threshold 이상 비슷하면 그 묶음, 아니면 새로.

    비슷한 쌍을 모두 이어 붙이면(A~B, B~C → A~C) 크래프톤 91건 중 84건이 한 묶음이 될 만큼
    번져서, 묶음의 첫 기사하고만 비교한다.
    ponytail: 기사 n건 × 묶음 수만큼 비교(회사당 100건 안팎이라 1초 이내). 수천 건이면 pgvector로.
    """
    leaders: list[list[float]] = []
    groups = []
    for v in vectors:
        g = next((n for n, lead in enumerate(leaders) if _cosine(lead, v) >= threshold), None)
        if g is None:
            g = len(leaders)
            leaders.append(v)
        groups.append(g)
    return groups


def fetch_news(query: str, out: Path) -> list[dict[str, Any]]:
    """검색해 고른 기사를 out(JSON)에 쌓고, 같은 사건 기사끼리 group 번호를 붙여 저장한다."""
    old = json.loads(out.read_text(encoding="utf-8"))["items"] if out.exists() else []
    items: list[dict[str, Any]] = merge(old, select(_get(query), query, date.today()), date.today())
    if items:
        for item, g in zip(items, group(embed([i["title"] for i in items])), strict=True):
            item["group"] = g
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"query": query, "collected_at": datetime.now().isoformat(timespec="seconds")}
    out.write_text(
        json.dumps({**payload, "items": items}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return items


def load(name: str, data: Path) -> list[dict[str, Any]]:
    """모아 둔 기사. 아직 안 모았으면 빈 목록(카드에 최근 이슈 없음)."""
    path = data / "news" / f"{name}.json"
    items: list[dict[str, Any]] = (
        json.loads(path.read_text(encoding="utf-8"))["items"] if path.exists() else []
    )
    return items


def collect(company: dict[str, str], data: Path) -> list[dict[str, Any]]:
    """회사 하나의 기사를 모아 data/news/{회사명}.json에 쌓는다."""
    query = company.get("news_query", company["name"])
    return fetch_news(query, data / "news" / f"{company['name']}.json")


if __name__ == "__main__":
    # cd ai && uv run --env-file .env python -m pipeline.news
    here = Path(__file__).parent
    for company in json.loads((here / "companies.json").read_text(encoding="utf-8")):
        print(f"{company['name']}: {len(collect(company, here / 'data'))}건")
