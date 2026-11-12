"""채점자 라벨(labels/rater-*.json)을 합쳐 합의 라벨(labels/consensus.json)을 만든다(효용지표 5.2).

- 항목마다 과반이 같은 단계를 주면 그 단계로 정한다.
- 과반이 없으면(2명이 다르거나 3명이 모두 다르면) 토론 대상이다.
  labels/disputes.csv에 각 채점자의 단계를 적고 `합의`·`이유` 칸을 비워 둔다.
  토론해 두 칸을 채운 뒤 다시 실행하면 그 값을 쓴다. 채운 칸은 다시 실행해도 유지한다.
- 합의 칸이 빈 토론 대상이 남아 있으면 consensus.json을 쓰지 않는다.

실행(ai 폴더): uv run python -m eval.golden.make_consensus
"""

import csv
import json
import sys
from collections import Counter

from eval.golden.build_items import CRITERIA, LABELS_DIR

DISPUTES = LABELS_DIR / "disputes.csv"
LEVELS = ("1", "2", "3")


def read_disputes() -> dict[tuple[str, str], tuple[str, str]]:
    """(id, 항목)별로 이미 적은 (합의, 이유)를 읽는다."""
    if not DISPUTES.exists():
        return {}
    with DISPUTES.open(encoding="utf-8-sig", newline="") as f:
        return {
            (row["id"], row["항목"]): (row["합의"].strip(), row["이유"].strip())
            for row in csv.DictReader(f)
        }


def main() -> None:
    rater_files = sorted(LABELS_DIR.glob("rater-*.json"))
    if len(rater_files) < 2:
        sys.exit("채점자 라벨이 2개 이상 필요하다")
    raters = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in rater_files}
    previous = read_disputes()

    consensus: dict[str, dict[str, int]] = {}
    disputes: list[list[str]] = []
    unresolved = 0
    for item_id in sorted(next(iter(raters.values()))):
        consensus[item_id] = {}
        for criterion in CRITERIA:
            levels = [labels[item_id][criterion] for labels in raters.values()]
            level, count = Counter(levels).most_common(1)[0]
            if count * 2 > len(levels):
                consensus[item_id][criterion] = level
                continue
            agreed, reason = previous.get((item_id, criterion), ("", ""))
            disputes.append([item_id, criterion, *map(str, levels), agreed, reason])
            if agreed in LEVELS:
                consensus[item_id][criterion] = int(agreed)
            else:
                unresolved += 1

    if disputes:
        with DISPUTES.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["id", "항목", *raters, "합의", "이유"])
            writer.writerows(disputes)
    if unresolved:
        sys.exit(f"토론 대상 {unresolved}건: {DISPUTES.name}의 합의·이유 칸을 채운 뒤 다시 실행")
    (LABELS_DIR / "consensus.json").write_text(
        json.dumps(consensus, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"합의 라벨 {len(consensus)}개, 토론으로 정한 항목 {len(disputes)}개")


if __name__ == "__main__":
    main()
