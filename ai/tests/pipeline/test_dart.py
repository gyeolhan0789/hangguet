import json
from pathlib import Path

import pytest

from pipeline.dart import find_corp_code, latest_annual_report

# 2026-10-19 DART에서 받은 실제 응답 일부 (고유번호 목록은 두 회사 항목만 남김)
FIXTURES = Path(__file__).parent / "fixtures"
CORP_XML = (FIXTURES / "corpcode_sample.xml").read_bytes()
LISTING = json.loads((FIXTURES / "list_kakao.json").read_text(encoding="utf-8"))


def test_find_corp_code_picks_listed_company_among_same_names() -> None:
    # '카카오'는 비상장(00918444)과 상장(00258801) 두 개가 있다
    assert find_corp_code(CORP_XML, "카카오") == "00258801"
    assert find_corp_code(CORP_XML, "삼성전자") == "00126380"


def test_find_corp_code_unknown_name() -> None:
    with pytest.raises(LookupError):
        find_corp_code(CORP_XML, "없는회사")


def test_latest_annual_report_skips_half_and_quarter_reports() -> None:
    assert latest_annual_report(LISTING) == next(
        i["rcept_no"] for i in LISTING["list"] if i["report_nm"] == "사업보고서 (2025.12)"
    )


def test_latest_annual_report_missing() -> None:
    with pytest.raises(LookupError):
        latest_annual_report({"status": "000", "list": []})


def test_latest_annual_report_api_error() -> None:
    with pytest.raises(RuntimeError):
        latest_annual_report({"status": "020", "message": "요청 제한 초과"})
