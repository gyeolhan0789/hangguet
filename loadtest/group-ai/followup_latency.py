"""그룹 면접 꼬리질문 판단(AI 명세 6.7)의 GMS 응답 시간을 측정한다(report/group-ai-2026-11-15.md).

골든셋 답변(ai/eval/golden/items.jsonl)을 일정 간격으로 선택해
에이전트와 같은 프롬프트로 GMS에 요청한다.
에이전트는 5초(GROUP_FOLLOWUP_TIMEOUT)에서 대기를 중단하지만,
분포 전체를 확인하기 위해 여기서는 30초까지 대기한다.
동시 요청 수는 여러 그룹이 같은 순간에 판단 단계에 들어가는 경우를 재현한다.

    LLM_API_KEY=... LLM_CHAT_URL=... LLM_MODEL=gpt-5.6-terra \\
      ai/.venv/Scripts/python.exe loadtest/group-ai/followup_latency.py 60 1 \
      > loadtest/results/group-ai/followup-c1.csv

인자는 선택할 답변 수(기본 60)와 동시 요청 수(기본 1)다.
결과는 CSV(표준 출력)와 요약(표준 오류)이다.
"""

import csv
import json
import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ai"))

from app.common.gms import GmsBadOutputError, GmsClient, GmsUnavailableError  # noqa: E402
from app.common.session import Persona  # noqa: E402
from app.common.settings import load_settings  # noqa: E402
from app.interview.realtime.followup import FollowupOutputError  # noqa: E402
from app.interview.realtime.group_followup import (  # noqa: E402
    GROUP_FOLLOWUP_TIMEOUT,
    group_followup_messages,
    parse_group_followup,
)

ITEMS = ROOT / "ai" / "eval" / "golden" / "items.jsonl"
# 분포 전체를 확인하기 위한 대기 상한(초). 에이전트 값(GROUP_FOLLOWUP_TIMEOUT)보다 길게 설정한다
WAIT_SECONDS = 30.0


def pick(count: int) -> list[dict]:
    """150개 중 count개를 같은 간격으로 선택한다.

    답변 수준 3단계와 면접관이 고르게 포함되게 하기 위함이다.
    """
    items = [json.loads(line) for line in ITEMS.read_text(encoding="utf-8").splitlines() if line]
    step = len(items) / count
    return [items[int(i * step)] for i in range(count)]


def run_one(client: GmsClient, item: dict) -> dict:
    messages = group_followup_messages(
        Persona(item["persona"]), item["question"], item["criteria"], item["content"], None
    )
    started = time.perf_counter()
    outcome = "needed"
    try:
        result = client.chat_json(messages)
        if parse_group_followup(result.content) is None:
            outcome = "not_needed"
    except GmsUnavailableError:
        outcome = "unavailable"
    except (GmsBadOutputError, FollowupOutputError):
        outcome = "bad_output"
    ms = round((time.perf_counter() - started) * 1000)
    return {"id": item["id"], "persona": item["persona"], "ms": ms, "outcome": outcome}


def percentile(values: list[int], q: float) -> int:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(q * (len(ordered) - 1)))]


def main() -> None:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    concurrency = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    client = GmsClient.from_settings(
        load_settings(os.environ), timeout=WAIT_SECONDS, retry_delays=()
    )
    items = pick(count)
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        rows = list(pool.map(lambda item: run_one(client, item), items))

    out = csv.DictWriter(sys.stdout, fieldnames=["id", "persona", "ms", "outcome"])
    out.writeheader()
    out.writerows(rows)

    ok = [r["ms"] for r in rows if r["outcome"] in ("needed", "not_needed")]
    limit_ms = GROUP_FOLLOWUP_TIMEOUT * 1000
    summary = {
        "count": len(rows),
        "concurrency": concurrency,
        "p50": percentile(ok, 0.5) if ok else None,
        "p90": percentile(ok, 0.9) if ok else None,
        "max": max(ok) if ok else None,
        "mean": round(statistics.mean(ok)) if ok else None,
        f"over_{limit_ms:.0f}ms": sum(1 for v in ok if v > limit_ms),
        "needed": sum(1 for r in rows if r["outcome"] == "needed"),
        "not_needed": sum(1 for r in rows if r["outcome"] == "not_needed"),
        "bad_output": sum(1 for r in rows if r["outcome"] == "bad_output"),
        "unavailable": sum(1 for r in rows if r["outcome"] == "unavailable"),
    }
    print(json.dumps(summary, ensure_ascii=False), file=sys.stderr)


if __name__ == "__main__":
    main()
