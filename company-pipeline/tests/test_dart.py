import io
import json
import zipfile
from pathlib import Path

import pytest

from pipeline import dart, storage
from pipeline.dart import find_corp_code, latest_annual_report

# 2026-10-19 DART에서 받은 실제 응답 일부 (고유번호 목록은 일부 항목만 남김)
FIXTURES = Path(__file__).parent / "fixtures"
CORP_XML = (FIXTURES / "corpcode_sample.xml").read_bytes()
LISTING = json.loads((FIXTURES / "list_kakao.json").read_text(encoding="utf-8"))


def test_find_corp_code_picks_listed_company_among_same_names() -> None:
    # '카카오'는 비상장(00918444)과 상장(00258801) 두 개가 있다
    assert find_corp_code(CORP_XML, "카카오") == "00258801"
    assert find_corp_code(CORP_XML, "삼성전자") == "00126380"


def test_find_corp_code_skips_old_merged_company() -> None:
    # 옛 SK(00144155, 2015년 합병)도 종목코드를 단 채 남아 있다. 최근 수정된 SK를 고른다
    assert find_corp_code(CORP_XML, "SK") == "00181712"


def test_find_corp_code_unlisted_company_with_unique_name() -> None:
    # 미래에셋자산운용은 비상장이지만 사업보고서를 낸다
    assert find_corp_code(CORP_XML, "미래에셋자산운용") == "00259776"


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


def test_fetch_report_downloads_again_only_when_new_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    latest = {"rcept_no": "20260314000001"}
    calls: list[str] = []

    def fake_get(path: str, **params: str) -> bytes:
        calls.append(path)
        if path == "corpCode.xml":
            return _zip({"CORPCODE.xml": CORP_XML})
        if path == "list.json":
            item = {"report_nm": "사업보고서", "rcept_no": latest["rcept_no"]}
            return json.dumps({"status": "000", "list": [item]}).encode()
        rcept_no = params["rcept_no"]
        return _zip({f"{rcept_no}.xml": f"보고서 {rcept_no}".encode()})

    monkeypatch.setattr(dart, "_get", fake_get)

    assert dart.fetch_report("카카오")[:2] == ("00258801", "보고서 20260314000001")
    dart.fetch_report("카카오")  # 같은 사업보고서면 원문을 다시 받지 않는다
    latest["rcept_no"] = "20270313000002"  # 이듬해 새 사업보고서
    assert dart.fetch_report("카카오")[1] == "보고서 20270313000002"
    assert storage.keys("raw/dart/reports/00258801/") == [
        "raw/dart/reports/00258801/20260314000001.xml",
        "raw/dart/reports/00258801/20270313000002.xml",
    ]  # 지난 보고서도 남는다
    assert dart.latest_report("00258801") == "보고서 20270313000002"
    assert calls == [
        "corpCode.xml",
        "list.json",
        "document.xml",
        "list.json",
        "list.json",
        "document.xml",
    ]


def test_fetch_report_skips_correction_without_document(monkeypatch: pytest.MonkeyPatch) -> None:
    # 2026-10-22 한화에어로스페이스: [첨부정정]사업보고서는 본문 파일이 없어 014 XML이 온다
    missing = b'<?xml version="1.0" encoding="UTF-8"?><result><status>014</status></result>'

    def fake_get(path: str, **params: str) -> bytes:
        if path == "corpCode.xml":
            return _zip({"CORPCODE.xml": CORP_XML})
        if path == "list.json":
            items = [
                {
                    "report_nm": "[첨부정정]사업보고서 (2025.12)",
                    "rcept_no": "20260319000633",
                    "rcept_dt": "20260319",
                },
                {
                    "report_nm": "사업보고서 (2025.12)",
                    "rcept_no": "20260316001112",
                    "rcept_dt": "20260316",
                },
            ]
            return json.dumps({"status": "000", "list": items}).encode()
        if params["rcept_no"] == "20260319000633":
            return missing
        return _zip({"20260316001112.xml": "본문".encode()})

    monkeypatch.setattr(dart, "_get", fake_get)

    # 보고서 정보도 실제로 읽은(본문이 있는) 보고서의 것이다
    assert dart.fetch_report("카카오") == (
        "00258801",
        "본문",
        {
            "rcept_no": "20260316001112",
            "title": "사업보고서 (2025.12)",
            "url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260316001112",
            "published": "2026-03-16",
        },
    )


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_latest_annual_report_no_filings_is_not_an_api_error() -> None:
    # 2026-10-22 코스콤 실제 응답: 사업보고서를 안 내는 회사는 013(조회된 데이터 없음)
    with pytest.raises(LookupError):
        latest_annual_report({"status": "013", "message": "조회된 데이타가 없습니다."})
    with pytest.raises(RuntimeError):
        latest_annual_report({"status": "020", "message": "요청 제한을 초과하였습니다."})
