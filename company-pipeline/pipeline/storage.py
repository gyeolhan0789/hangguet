"""원문 저장소: 키(경로)로 파일을 넣고 꺼낸다.

S3_ENDPOINT가 있으면 MinIO(S3 호환), 없으면 PIPELINE_DATA_DIR(기본 pipeline/data) 아래 폴더에 둔다.
키 구조: reference/·raw/·processed/ (자율프로젝트/MinIO_저장구조.md)
"""

import os
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Any

import boto3


def _root() -> Path:
    return Path(os.environ.get("PIPELINE_DATA_DIR", Path(__file__).parent / "data"))


@cache
def _s3(endpoint: str) -> Any:
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
    )


def _bucket() -> tuple[Any, str] | None:
    endpoint = os.environ.get("S3_ENDPOINT")
    return (_s3(endpoint), os.environ["S3_BUCKET"]) if endpoint else None


def put(key: str, data: bytes) -> None:
    if s3 := _bucket():
        s3[0].put_object(Bucket=s3[1], Key=key, Body=data)
        return
    path = _root() / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def get(key: str) -> bytes | None:
    """없으면 None."""
    if s3 := _bucket():
        try:
            body: bytes = s3[0].get_object(Bucket=s3[1], Key=key)["Body"].read()
        except s3[0].exceptions.NoSuchKey:
            return None
        return body
    path = _root() / key
    return path.read_bytes() if path.exists() else None


def keys(prefix: str) -> list[str]:
    """prefix로 시작하는 키 목록(정렬). 예: keys("raw/dart/reports/00258801/")"""
    if s3 := _bucket():
        pages = s3[0].get_paginator("list_objects_v2").paginate(Bucket=s3[1], Prefix=prefix)
        return sorted(obj["Key"] for page in pages for obj in page.get("Contents", []))
    root = _root()
    base = root / prefix
    folder = base if prefix.endswith("/") else base.parent
    if not folder.exists():
        return []
    found = (p.relative_to(root).as_posix() for p in folder.rglob("*") if p.is_file())
    return sorted(k for k in found if k.startswith(prefix))


def modified(key: str) -> datetime | None:
    """마지막으로 넣은 시각(UTC). 없으면 None."""
    if s3 := _bucket():
        try:
            when: datetime = s3[0].head_object(Bucket=s3[1], Key=key)["LastModified"]
        except s3[0].exceptions.ClientError:
            return None
        return when
    path = _root() / key
    return datetime.fromtimestamp(path.stat().st_mtime, UTC) if path.exists() else None
