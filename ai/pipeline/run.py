"""①→④를 순서대로 실행해 회사 카드를 만든다.

cd ai && uv run --env-file .env python -m pipeline.run
cd ai && uv run --env-file .env python -m pipeline.run --only 카카오
"""

import argparse
import json
import logging
from pathlib import Path

from pipeline import card, dart, extract, verify, viewer

HERE = Path(__file__).parent
DATA = HERE / "data"
REPORT_SOURCE = "최신 사업보고서 II. 사업의 내용"
log = logging.getLogger("pipeline")


def build_one(company: dict[str, str], data: Path = DATA) -> Path:
    """회사 하나의 카드를 만들어 data/cards/{고유번호}.json에 저장한다."""
    name = company["name"]
    corp_code, report = dart.fetch_report(name, data / "raw")
    section = extract.business_section(report)
    business, market = card.business_input(section), card.market_input(section)
    talent = company.get("talent_text", "")
    llm = card.call_llm(card.build_messages(name, talent, business))
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
    for item in dropped:
        log.warning("%s: 검증 실패로 버림 [%s] %s", name, item["field"], item.get("quote"))
    if not result["talent"] and not result["direction"]:
        raise ValueError(f"{name}: 검증을 통과한 항목이 없다")
    out = data / "cards" / f"{corp_code}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="회사 카드 생성")
    parser.add_argument("--only", help="이 회사만 실행 (companies.json의 name)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    companies = json.loads((HERE / "companies.json").read_text(encoding="utf-8"))
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
