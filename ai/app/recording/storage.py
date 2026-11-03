"""녹화 원본 트랙을 조회·다운로드하고 합친 mp4를 업로드하는 저장소(S3).

처리 함수는 저장소 Protocol에만 의존하므로 시험은 S3 없이 가짜 저장소로 검사한다.
목록 조회에는 원본 위치의 s3:ListBucket 권한이 필요하다.
권한이 없으면 조회가 실패해 STORAGE_ERROR로 보고된다.
"""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

import boto3
from boto3.exceptions import Boto3Error
from botocore.exceptions import BotoCoreError, ClientError

from app.common.settings import Settings

MP4_CONTENT_TYPE = "video/mp4"


class StorageError(Exception):
    """저장소에서 파일을 조회·다운로드·업로드하지 못했다."""


@dataclass(frozen=True)
class StoredObject:
    """저장소 파일의 키와 저장소가 기록한 저장 시각(S3 LastModified)."""

    key: str
    last_modified: datetime


class RecordingStorage(Protocol):
    def list(self, prefix: str) -> list[StoredObject]:
        """prefix로 시작하는 파일 목록이다. 실패하면 StorageError다."""
        ...

    def download(self, key: str, path: Path) -> None:
        """key의 파일을 path에 저장한다. 실패하면 StorageError다."""
        ...

    def upload(self, path: Path, key: str) -> None:
        """path의 mp4를 key에 업로드한다. 실패하면 StorageError다."""
        ...


class S3RecordingStorage:
    def __init__(self, client: Any, bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    def list(self, prefix: str) -> list[StoredObject]:
        try:
            # 한 번에 최대 1,000개만 반환하므로 페이지를 끝까지 조회한다
            pages = self._client.get_paginator("list_objects_v2").paginate(
                Bucket=self._bucket, Prefix=prefix
            )
            return [
                StoredObject(item["Key"], item["LastModified"])
                for page in pages
                for item in page.get("Contents", [])
            ]
        except (ClientError, BotoCoreError) as e:
            raise StorageError(f"목록 조회 실패 {prefix}: {_code(e)}") from e

    def download(self, key: str, path: Path) -> None:
        try:
            self._client.download_file(self._bucket, key, str(path))
        # download_file은 재시도 횟수를 넘긴 오류를 BotoCoreError가 아닌 Boto3Error로 발생시킨다
        except (ClientError, BotoCoreError, Boto3Error) as e:
            raise StorageError(f"다운로드 실패 {key}: {_code(e)}") from e

    def upload(self, path: Path, key: str) -> None:
        try:
            # 다시보기에서 브라우저가 영상으로 재생하도록 형식을 지정한다
            self._client.upload_file(
                str(path), self._bucket, key, ExtraArgs={"ContentType": MP4_CONTENT_TYPE}
            )
        # upload_file은 S3 오류를 ClientError가 아닌 S3UploadFailedError(Boto3Error)로 발생시킨다
        except (ClientError, BotoCoreError, Boto3Error) as e:
            raise StorageError(f"업로드 실패 {key}: {_code(e)}") from e


def _code(error: Exception) -> str:
    # 응답 본문 대신 오류 코드만 남긴다
    if isinstance(error, ClientError):
        return str(error.response.get("Error", {}).get("Code", "unknown"))
    return type(error).__name__


def create_s3_storage(settings: Settings) -> S3RecordingStorage:
    """설정의 버킷·리전으로 S3 저장소를 생성한다.

    S3_BUCKET이 없으면 StorageError다.
    클라이언트 생성은 S3에 접속하지 않으므로 자격 증명은 처음 조회할 때 확인된다.
    """
    if settings.s3_bucket is None:
        raise StorageError("S3_BUCKET이 없다")
    client = boto3.client("s3", region_name=settings.aws_region)
    return S3RecordingStorage(client, settings.s3_bucket)
