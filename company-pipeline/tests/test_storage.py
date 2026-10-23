from pathlib import Path

from pipeline import storage


def test_local_put_get_keys(local_storage: Path) -> None:
    storage.put("raw/dart/reports/00258801/20260318001423.xml", b"report")
    storage.put("raw/dart/reports/00258801/20250318000001.xml", b"old")
    storage.put("raw/dart/reports/00258802/20260318000002.xml", b"other")

    assert storage.get("raw/dart/reports/00258801/20260318001423.xml") == b"report"
    assert storage.get("raw/dart/reports/00258801/없음.xml") is None
    assert storage.keys("raw/dart/reports/00258801/") == [
        "raw/dart/reports/00258801/20250318000001.xml",
        "raw/dart/reports/00258801/20260318001423.xml",
    ]  # 다른 회사 키는 안 섞이고, 정렬돼서 마지막이 최신 접수번호
    assert storage.keys("raw/news/") == []
    assert (
        local_storage / "raw/dart/reports/00258801/20260318001423.xml"
    ).read_bytes() == b"report"
