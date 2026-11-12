"""채점자가 채운 라벨링 시트를 라벨 파일로 바꾼다(효용지표 4.3).

labels/rater-a.csv(sheet.csv를 복사해 채운 파일)를 읽어
블라인드 번호를 골든셋 id로 되돌리고 labels/rater-a.json에 쓴다.
비었거나 1~3 밖인 칸이 있으면 쓰지 않고 실패한다.
사람끼리 일치도를 구하려면 빠진 칸이 없어야 하기 때문이다.

실행(ai 폴더): uv run python -m eval.golden.collect_labels rater-a
"""

import csv
import json
import sys

from eval.golden.build_items import CRITERIA, LABELS_DIR


def main(rater: str) -> None:
    blind_map: dict[str, str] = json.loads(
        (LABELS_DIR / "blind_map.json").read_text(encoding="utf-8")
    )
    labels: dict[str, dict[str, int]] = {}
    errors: list[str] = []
    with (LABELS_DIR / f"{rater}.csv").open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            blind_id = row["번호"]
            levels: dict[str, int] = {}
            for criterion in CRITERIA:
                value = row[criterion].strip()
                if value not in ("1", "2", "3"):
                    errors.append(f"{blind_id} {criterion}: '{value}'")
                    continue
                levels[criterion] = int(value)
            labels[blind_map[blind_id]] = levels
    errors += [f"{b}: 행 없음" for b, item_id in blind_map.items() if item_id not in labels]
    if errors:
        sys.exit("라벨을 확인하세요\n" + "\n".join(errors))
    (LABELS_DIR / f"{rater}.json").write_text(
        json.dumps(dict(sorted(labels.items())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"{rater}: {len(labels)}개")


if __name__ == "__main__":
    main(sys.argv[1])
