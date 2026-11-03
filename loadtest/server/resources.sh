#!/usr/bin/env bash
# 테스트 서버 자원 요약(load_test_plan 5.1 "자원은 판정하지 않고 측정한다", 8.1 단계별 자원). 서버에서 실행한다.
#   bash ~/a301/loadtest/server/resources.sh 5m            # 지금부터 5분 전까지
#   bash ~/a301/loadtest/server/resources.sh 3m 1762060000 # 끝 시각(유닉스 초)을 정해서
# 컨테이너별 CPU(코어, 구간 평균 · 최대) · 메모리(구간 최대, mem_limit 대비)와 서버 전체 CPU · steal · 메모리를 보여 준다.
# 서버 Prometheus(a301-prod-prometheus, 30초 수집)에 묻는다. cAdvisor가 30초마다 갱신하므로 30초보다 짧은 변화는 보이지 않는다.
set -euo pipefail

WINDOW="${1:-5m}"
AT="${2:-$(date +%s)}"

query() {
  local q
  q="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1")"
  docker exec a301-prod-prometheus wget -qO- "http://localhost:9090/api/v1/query?query=${q}&time=${AT}" \
    || { echo "FAIL: Prometheus 질의 실패: $1" >&2; exit 1; }
}

C='name=~"a301-prod-.+"'
CPU="rate(container_cpu_usage_seconds_total{${C}}[1m])"

python3 - "$WINDOW" "$AT" \
  "$(query "avg_over_time(${CPU}[${WINDOW}:30s])")" \
  "$(query "max_over_time(${CPU}[${WINDOW}:30s])")" \
  "$(query "max_over_time(container_memory_working_set_bytes{${C}}[${WINDOW}])")" \
  "$(query "max_over_time(container_spec_memory_limit_bytes{${C}}[${WINDOW}])")" \
  "$(query "avg_over_time((1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[1m])))[${WINDOW}:30s])")" \
  "$(query "max_over_time((1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[1m])))[${WINDOW}:30s])")" \
  "$(query "max_over_time(avg(rate(node_cpu_seconds_total{mode=\"steal\"}[1m]))[${WINDOW}:30s])")" \
  "$(query "max_over_time((1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)[${WINDOW}:30s])")" <<'PY'
import datetime, json, sys

window, at = sys.argv[1], int(sys.argv[2])
cpu_avg, cpu_max, mem, limit, node_avg, node_max, steal, node_mem = (json.loads(a)["data"]["result"] for a in sys.argv[3:11])

def by_name(result):
    return {r["metric"].get("name", ""): float(r["value"][1]) for r in result}

def scalar(result):
    return float(result[0]["value"][1]) if result else float("nan")

avg, mx, m, lim = by_name(cpu_avg), by_name(cpu_max), by_name(mem), by_name(limit)
end = datetime.datetime.fromtimestamp(at).strftime("%m/%d %H:%M:%S")
print(f"구간: {end}까지 {window}")
print(f"서버 CPU 평균 {scalar(node_avg):.0%} · 최대 {scalar(node_max):.0%}, steal 최대 {scalar(steal):.1%}, 메모리 최대 {scalar(node_mem):.0%}")
print(f"{'컨테이너':<30}{'CPU 평균':>9}{'CPU 최대':>9}{'메모리 최대':>12}{'상한 대비':>9}")
for name in sorted(m, key=lambda n: -m[n]):
    short = name.removeprefix("a301-prod-")
    used = m[name] / 2**20
    ratio = f"{m[name] / lim[name]:.0%}" if lim.get(name) else "-"
    print(f"{short:<30}{avg.get(name, 0):>9.2f}{mx.get(name, 0):>9.2f}{used:>10.0f}MB{ratio:>9}")
PY
