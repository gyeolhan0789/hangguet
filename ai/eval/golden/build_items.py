"""골든셋 답변(items.jsonl)과 블라인드 라벨링 시트를 만든다(효용지표 4.3·4.4·5.2).

- 질문·채점 기준·claimId는 plan_runs.json(실제 PLAN 결과)에서 가져온다.
- 원본 답변은 answers.json, 변형은 variants.json에서 만든다.
  PUNCTUATION(쉼표와 마지막 마침표를 뺌)·PERSONA(면접관만 바꿈)는 규칙으로 만든다.
- 라벨링 시트에는 원본과 변별력 변형만 넣는다.
  강건성 변형은 의미가 원본과 같아 사람 라벨이 필요 없다.
  id가 의도 단계와 변형 종류를 드러내므로 시트에는 순서를 섞은 블라인드 번호만 쓰고,
  번호와 id의 대응은 blind_map.json에 따로 둔다.

실행(ai 폴더): uv run python -m eval.golden.build_items
"""

import csv
import json
import random
from collections.abc import Mapping
from pathlib import Path
from typing import Any

GOLDEN_DIR = Path(__file__).parent
LABELS_DIR = GOLDEN_DIR / "labels"
CRITERIA = ("JOB_FIT", "COVER_LETTER", "LOGIC", "DELIVERY")
DISCRIMINATION_TYPES = {"NO_ACTION", "NO_RESULT", "SHUFFLED", "CONTRADICT_CL", "VERBOSE"}
PERSONA_ROTATION = {"DEVIL": "COFFEE_CHAT", "COFFEE_CHAT": "DUCK", "DUCK": "DEVIL"}
# 다시 만들어도 같은 순서가 나오도록 고정한다
SHUFFLE_SEED = 506


def read_json(name: str) -> Any:
    return json.loads((GOLDEN_DIR / name).read_text(encoding="utf-8"))


def original_items() -> list[dict[str, Any]]:
    runs = read_json("plan_runs.json")["runs"]
    items: list[dict[str, Any]] = []
    for qid, spec in read_json("answers.json").items():
        planned = runs[spec["coverLetterId"]]["questions"][spec["persona"]]["questions"]
        question = next(q for q in planned if q["seq"] == spec["seq"])
        for level in ("1", "2", "3"):
            items.append(
                {
                    "id": f"{qid}-a{level}",
                    "coverLetterId": spec["coverLetterId"],
                    "persona": spec["persona"],
                    "mode": "CHAT",
                    "seq": question["seq"],
                    "question": question["content"],
                    "criteria": question["criteria"],
                    "claimId": question["claimId"],
                    "content": spec["answers"][level],
                    "intendedLevel": int(level),
                    "variantOf": None,
                    "variantType": None,
                    "targetCriterion": None,
                }
            )
    return items


def variant_content(base: Mapping[str, Any], variant: Mapping[str, Any]) -> str:
    content: str = base["content"]
    if "content" in variant:
        return str(variant["content"])
    if variant["type"] == "PUNCTUATION":
        # 쉼표가 없으면 마지막 마침표만 빠져 변형이라 보기 어렵다
        if "," not in content:
            raise ValueError(f"{variant['of']} PUNCTUATION: 원본에 쉼표가 없다")
        return content.replace(",", "").removesuffix(".")
    for before, after in variant.get("replace", []):
        if before not in content:
            raise ValueError(f"{variant['of']} {variant['type']}: '{before}'가 원본에 없다")
        content = content.replace(before, after)
    return f"{variant.get('prefix', '')}{content}{variant.get('suffix', '')}"


def variant_items(originals: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for variant in read_json("variants.json")["variants"]:
        base = originals[variant["of"]]
        persona = base["persona"]
        if variant["type"] == "PERSONA":
            persona = PERSONA_ROTATION[persona]
        content = variant_content(base, variant)
        if content == base["content"] and variant["type"] != "PERSONA":
            raise ValueError(f"{variant['of']} {variant['type']}: 원본과 같다")
        items.append(
            dict(base)
            | {
                "id": f"{variant['of']}-{variant['type'].lower()}",
                "persona": persona,
                "content": content,
                # 변별력 변형은 겨냥한 항목만 낮추므로 답변 전체의 의도 단계가 없다
                "intendedLevel": (
                    None if variant["type"] in DISCRIMINATION_TYPES else base["intendedLevel"]
                ),
                "variantOf": variant["of"],
                "variantType": variant["type"],
                "targetCriterion": variant.get("target"),
            }
        )
    return items


def cover_letter_text(cover_letter: Mapping[str, Any]) -> str:
    items = cover_letter["coverLetterItems"]
    return "\n\n".join(f"[{item['question']}]\n{item['answer']}" for item in items)


def write_label_sheet(items: list[dict[str, Any]]) -> None:
    cover_letters = read_json("cover_letters.json")
    targets = [
        item
        for item in items
        if item["variantType"] is None or item["variantType"] in DISCRIMINATION_TYPES
    ]
    random.Random(SHUFFLE_SEED).shuffle(targets)
    blind_map = {f"b{i:03d}": item["id"] for i, item in enumerate(targets, start=1)}

    LABELS_DIR.mkdir(exist_ok=True)
    # 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다
    with (LABELS_DIR / "sheet.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["번호", "회사·직무", "자기소개서", "질문", "채점 기준", "답변", *CRITERIA])
        for blind_id, item in zip(blind_map, targets, strict=True):
            cover_letter = cover_letters[item["coverLetterId"]]
            writer.writerow(
                [
                    blind_id,
                    f"{cover_letter['companyName']} · {cover_letter['jobTitle']}",
                    cover_letter_text(cover_letter),
                    item["question"],
                    item["criteria"],
                    item["content"],
                    *([""] * len(CRITERIA)),
                ]
            )
    (LABELS_DIR / "blind_map.json").write_text(
        json.dumps(blind_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    originals = original_items()
    variants = variant_items({item["id"]: item for item in originals})
    items = originals + variants
    with (GOLDEN_DIR / "items.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    write_label_sheet(items)
    print(f"원본 {len(originals)}개, 변형 {len(variants)}개")


if __name__ == "__main__":
    main()
