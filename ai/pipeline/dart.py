"""① 공시 수집: 회사명 → DART 고유번호 → 최신 사업보고서 원문."""

import io
import json
import os
import urllib.parse
import urllib.request
import zipfile
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

API = "https://opendart.fss.or.kr/api"


def _get(path: str, **params: str) -> bytes:
    query = urllib.parse.urlencode({"crtfc_key": os.environ["DART_API_KEY"], **params})
    with urllib.request.urlopen(f"{API}/{path}?{query}", timeout=60) as res:
        body: bytes = res.read()
    return body


def _unzip(data: bytes, prefer: str | None = None) -> bytes:
    """zip 안에서 prefer 파일을, 없으면 가장 큰 파일을 꺼낸다.

    사업보고서 원문 zip에는 본문({접수번호}.xml)과 첨부 문서가 함께 들어 있다.
    """
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = zf.namelist()
        name = prefer if prefer in names else max(names, key=lambda n: zf.getinfo(n).file_size)
        return zf.read(name)


def find_corp_code(corp_xml: bytes, name: str) -> str:
    """고유번호 목록에서 상장사(종목코드 있음) 중 회사명이 정확히 같은 회사를 찾는다."""
    for item in ElementTree.fromstring(corp_xml).iter("list"):
        listed = (item.findtext("stock_code") or "").strip()
        if listed and (item.findtext("corp_name") or "").strip() == name:
            return (item.findtext("corp_code") or "").strip()
    raise LookupError(f"상장사 목록에 없는 회사명: {name}")


def latest_annual_report(listing: dict[str, Any]) -> str:
    """공시 검색 결과(최신순)에서 가장 최근 사업보고서의 접수번호를 고른다."""
    if listing.get("status") not in (None, "000"):
        raise RuntimeError(f"DART 공시 검색 실패: {listing.get('status')} {listing.get('message')}")
    for item in listing.get("list", []):
        if "사업보고서" in item.get("report_nm", ""):
            return str(item["rcept_no"])
    raise LookupError("최근 1년 안에 사업보고서가 없다")


def fetch_report(name: str, raw_dir: Path) -> tuple[str, str]:
    """회사의 최신 사업보고서 원문을 raw_dir에 저장하고 (고유번호, 원문)을 돌려준다.

    이미 받은 파일이 있으면 다시 받지 않는다(호출 한도 절약).
    """
    corp_file = raw_dir / "CORPCODE.xml"
    if not corp_file.exists():
        raw_dir.mkdir(parents=True, exist_ok=True)
        corp_file.write_bytes(_unzip(_get("corpCode.xml")))
    corp_code = find_corp_code(corp_file.read_bytes(), name)

    report_file = raw_dir / corp_code / "report.xml"
    if not report_file.exists():
        begin = (date.today() - timedelta(days=365)).strftime("%Y%m%d")
        listing = json.loads(
            _get(
                "list.json",
                corp_code=corp_code,
                bgn_de=begin,
                pblntf_ty="A",
                pblntf_detail_ty="A001",
                page_count="100",
            )
        )
        rcept_no = latest_annual_report(listing)
        report_file.parent.mkdir(parents=True, exist_ok=True)
        report_file.write_bytes(_unzip(_get("document.xml", rcept_no=rcept_no), f"{rcept_no}.xml"))
    return corp_code, report_file.read_text(encoding="utf-8", errors="replace")
