"""⑥ 카드 올리기: BE가 읽는 공용 버킷에 카드와 manifest를 올린다.

cd company-pipeline && uv run --env-file .env python -m pipeline.publish

- 원문·기사는 MinIO(storage.py)에 그대로 두고, 카드와 manifest만 AWS S3 공용 버킷(CARD_S3_BUCKET)에
  올린다. 개발·운영 BE가 같은 버킷을 읽어 각자 DB에 넣는다(docs/ERD-회사카드.md)
- 카드는 cards/{고유번호}/{sha256}.json에 올린다. 내용이 바뀌면 키도 바뀌어서, BE가 manifest를
  읽는 도중 다음 실행이 올라와도 manifest가 가리키는 카드는 그대로다. 바뀌지 않은 카드도 매번
  다시 올려 버킷 수명 주기(지난 카드 정리)가 지금 카드를 지우지 않게 한다
- manifest.json은 카드를 모두 올린 뒤 마지막에 쓴다. BE는 manifest만 보고 적재한다
- 회사 목록에 있고 카드가 있는 회사만 올린다. 목록에서 뺀 회사는 manifest에서 빠진다
- CARD_S3_BUCKET이 없으면 data/publish/ 아래에 같은 경로로 쓴다(로컬 확인용)
"""

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from functools import cache
from pathlib import Path
from typing import Any

import boto3

from pipeline import candidates, dart

HERE = Path(__file__).parent
DATA = HERE / "data"
MANIFEST = "manifest.json"
FORMAT = 1  # manifest 형식 버전. 칸 뜻이 바뀌면 올리고 BE와 맞춘다
KST = timezone(timedelta(hours=9))


def aliases(company: dict[str, str], corp: candidates.Corp | None) -> list[str]:
    """지원서 회사명과 맞출 이름들: 회사명, 영문명, 기사 검색어, 별칭 칸.

    candidates.key로 띄어쓰기·(주)·Co., Ltd 등을 빼고 소문자로 맞춘다. BE도 지원서 회사명을
    같은 규칙으로 맞춘 뒤 찾는다.
    """
    names = [
        company["name"],
        corp.eng if corp else "",
        company.get("news_query", ""),
        *company.get("aliases", "").split(","),
    ]
    keys = (candidates.key(n) for n in names)
    return list(dict.fromkeys(k for k in keys if k))


def build(
    data: Path, companies: list[dict[str, str]], corps: dict[str, candidates.Corp]
) -> tuple[dict[str, Any], dict[str, bytes]]:
    """(manifest, 올릴 카드 {키: 내용}). 카드가 아직 없는 회사(대기 중)는 뺀다."""
    cards: dict[str, bytes] = {}
    for path in sorted((data / "cards").glob("*.json")):
        body = path.read_bytes()
        cards[json.loads(body)["name"]] = body
    uploads: dict[str, bytes] = {}
    rows = []
    for company in companies:
        found = cards.get(company["name"])
        if found is None:
            continue
        card = json.loads(found)
        code, digest = card["corp_code"], hashlib.sha256(found).hexdigest()
        corp = corps.get(code)
        key = f"cards/{code}/{digest}.json"
        uploads[key] = found
        rows.append(
            {
                "corp_code": code,
                "name": card["name"],
                "is_listed": corp.listed if corp else False,
                "aliases": aliases(company, corp),
                "generated_at": card["generated_at"],
                "card_key": key,
                "sha256": digest,
            }
        )
    run_id = datetime.now(KST).isoformat(timespec="seconds")
    return {"format": FORMAT, "run_id": run_id, "companies": rows}, uploads


@cache
def _s3() -> Any:
    return boto3.client(
        "s3",
        region_name=os.environ.get("CARD_AWS_REGION", "ap-northeast-2"),
        aws_access_key_id=os.environ["CARD_AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["CARD_AWS_SECRET_ACCESS_KEY"],
    )


def _put(key: str, body: bytes, data: Path) -> str:
    if bucket := os.environ.get("CARD_S3_BUCKET"):
        _s3().put_object(
            Bucket=bucket, Key=key, Body=body, ContentType="application/json; charset=utf-8"
        )
        return f"s3://{bucket}/{key}"
    path = data / "publish" / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return str(path)


def publish(
    data: Path = DATA,
    companies: list[dict[str, str]] | None = None,
    corps: dict[str, candidates.Corp] | None = None,
) -> str:
    """카드를 올리고 마지막에 manifest를 쓴다. manifest 위치를 돌려준다.

    올릴 카드가 하나도 없으면 ValueError(빈 manifest로 BE가 헛도는 일이 없게).
    """
    if companies is None:
        companies = json.loads(candidates.companies_file().read_text(encoding="utf-8"))
    if corps is None:
        corps = {c.code: c for c in candidates.corps(dart.corpcode_xml())}
    manifest, uploads = build(data, companies, corps)
    if not uploads:
        raise ValueError("올릴 카드가 없다")
    for key, body in uploads.items():
        _put(key, body, data)
    body = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    return _put(MANIFEST, body, data)


if __name__ == "__main__":
    print(publish())
