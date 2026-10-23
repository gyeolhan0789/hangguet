from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def local_storage(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """테스트는 MinIO·실제 data 폴더 대신 임시 폴더 저장소를 쓴다."""
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    monkeypatch.setenv("PIPELINE_DATA_DIR", str(tmp_path))
    return tmp_path
