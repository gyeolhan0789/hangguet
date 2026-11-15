"""답변자 전사에 다른 참가자의 말이 섞였는지 집계한다(report/group-ai-2026-11-15.md).

group_run.cjs는 참가자마다 주제가 다른 답변(answers.json)을 마이크로 계속 재생하므로,
차례가 아닌 참가자도 발화하는 상태다. 에이전트가 답변자 마이크만 구독하면(그룹면접-설계 6.8)
답변 글에는 자기 주제 낱말만 나오고 다른 참가자의 주제 낱말은 나오지 않아야 한다.

    ai/.venv/Scripts/python.exe loadtest/group-ai/mixing.py <answers.csv> <run.json>...

answers.csv는 DB에서 추출한 session_id, seq, kind, content(헤더 포함)다.
"""

import csv
import json
import sys
from pathlib import Path

SPEC = json.loads((Path(__file__).with_name("answers.json")).read_text(encoding="utf-8"))
KEYWORDS = {p["id"]: p["keywords"] for p in SPEC["participants"]}


def main() -> None:
    who: dict[int, str] = {}
    for path in sys.argv[2:]:
        with open(path, encoding="utf-8") as f:
            run = json.load(f)
        groups = run.get("results", [run])
        for g in groups:
            for s in g.get("sessions", []):
                who[s["sessionId"]] = f"u{s['i']}"
    with open(sys.argv[1], encoding="utf-8") as f:
        answers = list(csv.DictReader(f))
    total = own_hit = mixed = 0
    examples = []
    for a in answers:
        me = who.get(int(a["session_id"]))
        if me is None or not a["content"].strip():
            continue
        total += 1
        text = a["content"]
        if any(k in text for k in KEYWORDS[me]):
            own_hit += 1
        others = [k for u, ks in KEYWORDS.items() if u != me for k in ks if k in text]
        if others:
            mixed += 1
            examples.append(
                {"session": a["session_id"], "seq": a["seq"], "speaker": me, "otherWords": others}
            )
    print(
        json.dumps(
            {
                "answers": total,
                "ownTopicWord": own_hit,
                "otherTopicWord": mixed,
                "examples": examples[:10],
            },
            ensure_ascii=False,
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
