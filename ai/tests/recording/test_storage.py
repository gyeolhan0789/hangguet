from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from boto3.exceptions import S3UploadFailedError
from botocore.exceptions import ClientError, EndpointConnectionError

from app.common.settings import load_settings
from app.recording.storage import (
    MP4_CONTENT_TYPE,
    S3RecordingStorage,
    StorageError,
    StoredObject,
    create_s3_storage,
)

AT = datetime(2026, 11, 3, 10, 0, tzinfo=UTC)


def client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "본문"}}, "Operation")


def pages(*keys_per_page: list[str]) -> MagicMock:
    client = MagicMock()
    client.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": key, "LastModified": AT} for key in keys]} if keys else {}
        for keys in keys_per_page
    ]
    return client


def test_list_reads_every_page() -> None:
    client = pages(["a", "b"], ["c"], [])
    assert S3RecordingStorage(client, "bucket").list("recordings/raw/55/") == [
        StoredObject("a", AT),
        StoredObject("b", AT),
        StoredObject("c", AT),
    ]
    client.get_paginator.assert_called_once_with("list_objects_v2")
    client.get_paginator.return_value.paginate.assert_called_once_with(
        Bucket="bucket", Prefix="recordings/raw/55/"
    )


@pytest.mark.parametrize(
    "error", [client_error("AccessDenied"), EndpointConnectionError(endpoint_url="s3")]
)
def test_list_failure_is_storage_error_without_body(error: Exception) -> None:
    client = MagicMock()
    client.get_paginator.return_value.paginate.side_effect = error
    with pytest.raises(StorageError) as raised:
        S3RecordingStorage(client, "bucket").list("p/")
    assert "본문" not in str(raised.value)


def test_download_and_upload_use_bucket_and_mp4_type(tmp_path: Path) -> None:
    client = MagicMock()
    storage = S3RecordingStorage(client, "bucket")
    storage.download("recordings/raw/55/a.mp4", tmp_path / "a.mp4")
    storage.upload(tmp_path / "o.mp4", "recordings/55.mp4")
    client.download_file.assert_called_once_with(
        "bucket", "recordings/raw/55/a.mp4", str(tmp_path / "a.mp4")
    )
    client.upload_file.assert_called_once_with(
        str(tmp_path / "o.mp4"),
        "bucket",
        "recordings/55.mp4",
        ExtraArgs={"ContentType": MP4_CONTENT_TYPE},
    )


@pytest.mark.parametrize(
    ("method", "args", "error"),
    [
        ("download_file", ("k", Path("p")), client_error("404")),
        ("download_file", ("k", Path("p")), EndpointConnectionError(endpoint_url="s3")),
        ("upload_file", (Path("p"), "k"), S3UploadFailedError("실패")),
    ],
)
def test_transfer_failures_are_storage_errors(
    method: str, args: tuple[Any, ...], error: Exception
) -> None:
    client = MagicMock()
    getattr(client, method).side_effect = error
    storage = S3RecordingStorage(client, "bucket")
    call = storage.download if method == "download_file" else storage.upload
    with pytest.raises(StorageError):
        call(*args)


def test_create_uses_bucket_and_region_from_settings() -> None:
    settings = load_settings({"S3_BUCKET": "bucket", "AWS_REGION": "ap-northeast-2"})
    with patch("app.recording.storage.boto3.client") as client:
        storage = create_s3_storage(settings)
    client.assert_called_once_with("s3", region_name="ap-northeast-2")
    assert storage._bucket == "bucket"


def test_create_without_bucket_is_storage_error() -> None:
    with patch("app.recording.storage.boto3.client") as client, pytest.raises(StorageError):
        create_s3_storage(load_settings({}))
    client.assert_not_called()
