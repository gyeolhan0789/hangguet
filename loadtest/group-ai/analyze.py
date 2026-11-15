"""group_run.cjs 결과와 CPU 기록을 합쳐 요약한다(report/group-ai-2026-11-15.md).

    ai/.venv/Scripts/python.exe loadtest/group-ai/analyze.py <run.json> <agent.csv> <host.csv>

- 질문 준비 시간: 면접방 단계가 ASKING이 된 시각부터
  그 차례 질문의 question.started를 화면이 수신한 시각까지
- 꼬리질문 판단 시간: DECIDING이 된 시각부터 다음 단계로 변경된 시각까지
  (화면 기준, BE 타이머와 별도로 확인한다)
- 에이전트 CPU: 면접 시작 버튼부터 모든 그룹이 끝날 때까지. 평균과 5초 단위 최대치, 메모리 최대치
- 발생기 포화: PC 전체 CPU 80%와 Docker VM 전체 CPU 80%를 넘은 표본 수(load_test_plan 3.2).
  PC 메모리 85% 초과 수도 계산하지만, Docker VM 실행만으로 넘으므로 판단에는 사용하지 않는다
"""

import csv
import json
import statistics
import sys


def rows(path: str) -> list[dict]:
    with open(path, encoding="utf-8-sig") as f:
        lines = [line for line in f if not line.startswith("#")]
    return list(csv.DictReader(lines))


def pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(q * (len(ordered) - 1)))]


def turn_times(group: dict) -> tuple[list[float], list[float], dict]:
    events = sorted(group.get("events", []), key=lambda e: e["t"])
    questions = group.get("questions", [])
    asking, deciding = [], []
    kinds: dict[str, int] = {}
    for i, e in enumerate(events):
        turn = e.get("turn")
        if e.get("phase") == "ASKING" and turn:
            q = next(
                (
                    q
                    for q in questions
                    if q["sessionId"] == turn["sessionId"]
                    and q["seq"] == turn["seq"]
                    and q["t"] >= e["t"]
                ),
                None,
            )
            if q:
                asking.append((q["t"] - e["t"]) / 1000)
            kinds[turn["kind"]] = kinds.get(turn["kind"], 0) + 1
        if e.get("phase") == "DECIDING" and i + 1 < len(events):
            deciding.append((events[i + 1]["t"] - e["t"]) / 1000)
    return asking, deciding, kinds


def main() -> None:
    with open(sys.argv[1], encoding="utf-8") as f:
        run = json.load(f)
    agent = rows(sys.argv[2])
    host = rows(sys.argv[3])
    groups = [g for g in run["results"] if "error" not in g]
    start = min(g["startClickedAt"] for g in groups) / 1000
    end = max(g.get("ended") or g["events"][-1]["t"] for g in groups) / 1000

    asking_all, deciding_all = [], []
    per_group = []
    for g in groups:
        asking, deciding, kinds = turn_times(g)
        asking_all += asking
        deciding_all += deciding
        per_group.append(
            {
                "groupId": g["groupId"],
                "minutes": round(
                    ((g.get("ended") or g["events"][-1]["t"]) - g["startClickedAt"]) / 60000, 1
                ),
                "questions": len(g["questions"]),
                "turnKinds": kinds,
                "joinSpanSeconds": round(
                    (max(g["joinAt"].values()) - min(g["joinAt"].values())) / 1000, 1
                ),
                "startEnabledAfterLastJoinSeconds": round(
                    (g["startEnabledAt"] - max(g["joinAt"].values())) / 1000, 1
                ),
                "replay": {
                    k: (v or {}).get("videoStatus") for k, v in g.get("replays", {}).items()
                },
            }
        )

    window = [r for r in agent if start <= int(r["time"]) <= end]
    cores = [float(r["agent_cores"]) for r in window]
    hwin = [r for r in host if start <= int(r["time"]) <= end]
    summary = {
        "groups": per_group,
        "errors": [g["error"] for g in run["results"] if "error" in g],
        "askingToQuestionSeconds": {
            "n": len(asking_all),
            "p50": pct(asking_all, 0.5),
            "p90": pct(asking_all, 0.9),
            "max": max(asking_all, default=None),
        },
        "decidingSeconds": {
            "n": len(deciding_all),
            "p50": pct(deciding_all, 0.5),
            "p90": pct(deciding_all, 0.9),
            "max": max(deciding_all, default=None),
        },
        "agent": {
            "samples": len(window),
            "meanCores": round(statistics.mean(cores), 3) if cores else None,
            "max5sCores": max(cores, default=None),
            "maxMemMiB": max((int(r["agent_mem_mib"]) for r in window), default=None),
            "vmCpuOver80": sum(1 for r in window if float(r["vm_cpu_pct"]) > 80),
            "vmCpuMax": max((float(r["vm_cpu_pct"]) for r in window), default=None),
        },
        "host": {
            "samples": len(hwin),
            "cpuOver80": sum(1 for r in hwin if float(r["host_cpu_pct"]) > 80),
            "memOver85": sum(1 for r in hwin if float(r["host_mem_pct"]) > 85),
            "cpuMax": max((float(r["host_cpu_pct"]) for r in hwin), default=None),
            "memMax": max((float(r["host_mem_pct"]) for r in hwin), default=None),
        },
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
