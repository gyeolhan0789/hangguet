"""①→④를 순서대로 실행해 회사 카드를 만든다.

cd company-pipeline && uv run --env-file .env python -m pipeline.run
cd company-pipeline && uv run --env-file .env python -m pipeline.run --only 카카오
"""

import argparse
import json
import logging
from datetime import date
from pathlib import Path
from typing import Any

from pipeline import candidates, card, dart, extract, news, storage, verify, viewer

HERE = Path(__file__).parent
DATA = HERE / "data"
REPORT_SOURCE = "최신 사업보고서 II. 사업의 내용"
log = logging.getLogger("pipeline")


def _log_dropped(name: str, dropped: list[dict[str, Any]]) -> None:
    for item in dropped:
        log.warning("%s: 검증 실패로 버림 [%s] %s", name, item["field"], item.get("quote"))


def recent_issues(name: str, code: str) -> list[dict[str, Any]]:
    """모아 둔 기사(processed/news)로 최근 이슈를 만든다. 기사가 없으면 빈 목록."""
    articles = news.load(code)
    news_text = card.news_input(articles)
    if not news_text:
        return []
    llm = card.call_llm(card.build_recent_messages(name, news_text))
    kept, dropped = verify.verify_card({"recent": llm.get("recent", [])}, {"recent": news_text})
    _log_dropped(name, dropped)
    return card.link_articles(kept["recent"], articles)


def _save(result: dict[str, Any], data: Path) -> Path:
    out = data / "cards" / f"{result['corp_code']}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def build_one(company: dict[str, str], data: Path = DATA) -> Path:
    """회사 하나의 카드를 만들어 data/cards/{고유번호}.json에 저장한다."""
    name = company["name"]
    try:
        corp_code, report = dart.fetch_report(name)
        section = extract.business_section(report)
        business, market = card.business_input(section), card.market_input(section)
    except LookupError:
        # 사업보고서가 없는 회사(코스콤 등 비상장)는 인재상·최근 이슈만으로 부분 카드를 만든다.
        # 회사명이 DART에 없으면 여기서 다시 LookupError로 실패한다
        corp_code, business, market = dart.corp_code(name), "", ""
        log.info("%s: 최근 1년 사업보고서 없음, 인재상·최근 이슈만 만든다", name)
    talent = company.get("talent_text", "")
    if talent:  # 언제 무슨 문장이었는지 남긴다
        collected = company.get("talent_collected_at") or date.today().isoformat()
        storage.put(f"raw/talent/{corp_code}/{collected}.txt", talent.encode("utf-8"))
    llm: dict[str, Any] = {}
    if talent or business:
        llm |= card.call_llm(card.build_messages(name, talent, business))
    if market:
        llm |= card.call_llm(card.build_market_messages(name, market))
    result = card.to_card(
        llm,
        corp_code=corp_code,
        name=name,
        talent_source=company.get("talent_url", ""),
        report_source=REPORT_SOURCE,
    )
    result, dropped = verify.verify_card(
        result, {"talent": talent, "direction": business, "market": market}
    )
    _log_dropped(name, dropped)
    try:
        result["recent"] = recent_issues(name, corp_code)
    except (OSError, ValueError):  # LLM 오류·시간 초과·잘린 JSON
        # 사업보고서·인재상 카드는 살리고, 최근 이슈는 다음 매일 실행(refresh_recent)에서 채운다
        log.warning("%s: 최근 이슈 생성 실패, 비워 두고 저장", name, exc_info=True)
        result["recent"] = []
    if not any(result[k] for k in ("talent", "direction", "market", "recent")):
        raise ValueError(f"{name}: 검증을 통과한 항목이 없다")
    return _save(result, data)


def refresh_recent(company: dict[str, str], data: Path = DATA) -> Path:
    """매일 실행용: 기존 카드의 최근 이슈만 다시 만든다(LLM 1번). 카드가 없으면 전체를 만든다."""
    name = company["name"]
    for path in (data / "cards").glob("*.json"):
        result: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        if result["name"] == name:
            result["recent"] = recent_issues(name, result["corp_code"])
            result["generated_at"] = date.today().isoformat()
            return _save(result, data)
    return build_one(company, data)


def main() -> None:
    parser = argparse.ArgumentParser(description="회사 카드 생성")
    parser.add_argument("--only", help="이 회사만 실행 (companies.json의 name)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    companies = json.loads(candidates.companies_file().read_text(encoding="utf-8"))
    failed = []
    for company in companies:
        if args.only and company["name"] != args.only:
            continue
        try:
            log.info("완료 %s → %s", company["name"], build_one(company))
        except Exception:
            log.exception("실패 %s", company["name"])
            failed.append(company["name"])
    log.info("확인 화면 데이터 → %s (pipeline/viewer.html로 열기)", viewer.write(DATA))
    if failed:
        raise SystemExit(f"실패한 회사: {', '.join(failed)}")


if __name__ == "__main__":
    main()
