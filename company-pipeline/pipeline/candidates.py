"""회사 후보 추가 도구: 사람이 적은 회사 이름을 DART 정식 회사명·고유번호로 맞춰 준다.

자소설닷컴 등 채용 사이트를 보고 회사 이름만 한 줄에 하나씩 적는다(사이트 내용을 옮기지 않는다).
cd company-pipeline && uv run --env-file .env python -m pipeline.candidates 후보.txt

- 글자 규칙으로 못 찾으면 AI(LLM_*)에게 정식 회사명을 물어, DART 목록에 정확히 있는 이름만 쓴다
- DART에서 찾은 회사마다 상장 여부, 최근 1년 사업보고서 여부, 이미 카드가 있는지 알려 준다.
  사업보고서가 없으면(비상장 등) 인재상·최근 이슈만 있는 부분 카드가 된다
- 카드를 만들 수 있는 회사는 companies.json에 붙여 넣을 형태로 출력한다(인재상 칸은 사람이 채운다)
"""

import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree

from pipeline import card, dart

HERE = Path(__file__).parent
SUGGEST = 5  # 정확히 맞는 회사가 없을 때 보여 줄 비슷한 이름 수
_DROP = re.compile(
    r"\(주\)|㈜|주식회사|co\.?,?\.?\s*ltd\.?|corp(oration)?\.?|inc\.?|[\s.,·\-]", re.I
)


@dataclass(frozen=True)
class Corp:
    name: str
    eng: str
    code: str
    listed: bool


def corps(corp_xml: bytes) -> list[Corp]:
    """고유번호 목록. 같은 이름 상장사가 여럿이면(합병된 옛 회사) 최근 수정된 하나만 둔다."""
    items = sorted(
        ElementTree.fromstring(corp_xml).iter("list"),
        key=lambda i: i.findtext("modify_date") or "",
        reverse=True,
    )
    found, seen = [], set()
    for i in items:
        corp = Corp(
            (i.findtext("corp_name") or "").strip(),
            (i.findtext("corp_eng_name") or "").strip(),
            (i.findtext("corp_code") or "").strip(),
            bool((i.findtext("stock_code") or "").strip()),
        )
        if corp.listed and corp.name in seen:
            continue
        if corp.listed:
            seen.add(corp.name)
        found.append(corp)
    return found


def key(name: str) -> str:
    """비교용: 띄어쓰기·문장부호·(주)·Co., Ltd 등을 빼고 소문자로."""
    return _DROP.sub("", name).lower()


def match(query: str, all_corps: list[Corp]) -> tuple[Corp | None, list[Corp]]:
    """(확실히 맞는 회사, 비슷한 후보). 같은 이름이 여럿이면 상장사를 먼저 본다.

    정식 회사명 → 표기를 지운 회사명·영문명 순으로 찾고, 상장사가 하나면 그 회사로 정한다.
    """
    q = key(query)
    for same in (
        [c for c in all_corps if c.name == query.strip()],
        [c for c in all_corps if q and q in (key(c.name), key(c.eng))],
    ):
        listed = [c for c in same if c.listed]
        if len(listed) == 1 or (not listed and len(same) == 1):
            return (listed or same)[0], []
        if same:
            return None, sorted(same, key=lambda c: not c.listed)[:SUGGEST]
    similar = [c for c in all_corps if q and (q in key(c.name) or q in key(c.eng))]
    return None, sorted(similar, key=lambda c: (not c.listed, len(c.name)))[:SUGGEST]


# 약칭·영문 섞인 이름(삼성SDS, 네이버, 현대차)은 글자 규칙으로 못 찾아 AI에게 정식 회사명을 묻는다.
# AI 답은 고유번호 목록에서 하나로 정해질 때만 쓴다(목록에 없는 이름은 버려진다)
ASK = (
    "한국 회사 이름을 금융감독원 DART에 등록된 정식 회사명으로 바꾼다. "
    "약칭·영문·브랜드명을 정식명으로. 영문 회사명이나 바뀐 새 이름도 후보에 넣는다. "
    '모르면 빈 배열. JSON으로만 답한다: {"names": [str]} (가능성 높은 순, 최대 5개)'
)


def ask_official(query: str, all_corps: list[Corp]) -> Corp | None:
    """AI가 말한 정식 회사명 중 DART 목록에서 하나로 정해지는 첫 회사. AI 호출이 실패하면 None.

    AI는 "삼성에스디에스 주식회사"처럼 붙여 말해서, 표기를 지운 이름으로 DART 목록과 맞춘다.
    """
    try:
        ask = [{"role": "system", "content": ASK}, {"role": "user", "content": query}]
        reply = card.call_llm(ask)
    except (OSError, ValueError):  # GMS 일시 오류(502 등)면 글자 규칙 결과만 보여 준다
        return None
    for name in reply.get("names", []):
        corp, _ = match(str(name), all_corps)
        if corp is not None:
            return corp
    return None


def search(query: str, all_corps: list[Corp], limit: int = 10) -> list[Corp]:
    """화면 자동완성: 회사명·영문명에 입력이 들어간 회사. 정확히 같은 이름, 상장사, 짧은 이름 순."""
    q = key(query)
    if not q:
        return []
    found = [c for c in all_corps if q in key(c.name) or q in key(c.eng)]
    order = sorted(
        found, key=lambda c: (q not in (key(c.name), key(c.eng)), not c.listed, len(c.name))
    )
    return order[:limit]


def companies_file() -> Path:
    """회사 목록 파일. 노트북은 git의 pipeline/companies.json.

    서버는 COMPANIES_PATH(배포 때 덮어쓰지 않는 data/ 아래)를 쓴다. 확인 화면에서 추가한 회사가
    다음 배포에 사라지지 않게 하려는 것. 파일이 아직 없으면 git 목록을 복사해 시작한다.
    """
    seed = HERE / "companies.json"
    path = os.environ.get("COMPANIES_PATH")
    if not path:
        return seed
    target = Path(path)
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(seed, target)
    return target


def add(corp: Corp, extra: dict[str, str], companies: Path | None = None) -> None:
    """회사 목록 끝에 한 줄 추가. 이미 있으면 ValueError."""
    companies = companies or companies_file()
    rows = json.loads(companies.read_text(encoding="utf-8"))
    if any(r["name"] == corp.name for r in rows):
        raise ValueError(f"이미 있는 회사: {corp.name}")
    row = {"name": corp.name}
    if (query := extra.get("news_query", "").strip()) and query != corp.name:
        row["news_query"] = query
    for field in ("talent_url", "talent_text", "talent_collected_at"):
        row[field] = extra.get(field, "").strip()
    if not row["talent_text"]:  # 원문이 없으면 수집일도 비운다
        row["talent_collected_at"] = ""
    text = json.dumps([*rows, row], ensure_ascii=False, indent=2) + "\n"
    companies.write_text(text, encoding="utf-8", newline="\n")


def entry(corp: Corp, query: str) -> dict[str, str]:
    """companies.json 한 줄. 입력한 이름이 정식 회사명과 다르면 기사 검색어로 쓴다."""
    row = {"name": corp.name}
    if query.strip() != corp.name:
        row["news_query"] = query.strip()
    return row | {"talent_url": "", "talent_text": "", "talent_collected_at": ""}


def main() -> None:
    queries = [q.strip() for q in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()]
    queries = [q for q in queries if q and not q.startswith("#")]
    have = {c["name"] for c in json.loads(companies_file().read_text(encoding="utf-8"))}
    all_corps = corps(dart.corpcode_xml())
    ready = []
    for q in queries:
        corp, similar = match(q, all_corps)
        how = ""
        if corp is None and (corp := ask_official(q, all_corps)) is not None:
            how = " [AI로 정식명 찾음, 확인 필요]"
        if corp is None:
            hint = ", ".join(f"{c.name}({'상장' if c.listed else '비상장'})" for c in similar)
            print(f"? {q}: 정확히 맞는 회사 없음" + (f" → 비슷한 이름: {hint}" if hint else ""))
            continue
        label = f"{q} → {corp.name} ({corp.code}, {'상장' if corp.listed else '비상장'}){how}"
        if corp.name in have:
            print(f"- {label}: 이미 카드 있음")
            continue
        try:
            dart.annual_report_no(corp.code)
            print(f"✓ {label}: 추가 가능")
        except (LookupError, RuntimeError):
            print(f"△ {label}: 사업보고서 없음 → 인재상·최근 이슈만 있는 부분 카드")
        ready.append(entry(corp, q))
    if ready:
        print("\n# companies.json에 붙여 넣기 (인재상 칸은 공식 채용 페이지에서 채운다)")
        print(json.dumps(ready, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
