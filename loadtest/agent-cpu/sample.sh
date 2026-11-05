#!/usr/bin/env bash
# 개발 서버에서 면접 에이전트 컨테이너의 CPU · 메모리를 cgroup으로 직접 읽어 5초마다 CSV로 출력한다.
# 보고서: ../report/agent-cpu-dev-2026-11-05.md
#
# docker exec · docker stats를 쓰지 않는다. 컨테이너 안에 프로세스를 띄우면 그 CPU가 측정값에 섞인다.
# 실행(로컬 PC, 레포 루트, Git Bash). 첫 인자는 기록할 시간(초), 둘째 인자는 컨테이너 이름이다
#   mkdir -p loadtest/results/agent-cpu
#   ssh yobi-server 'bash -s -- 1200 a301-dev-ai-agent' < loadtest/agent-cpu/sample.sh > loadtest/results/agent-cpu/agent-cpu.csv
# 출력: 시각, 에이전트 코어(5초 평균), 에이전트 메모리(MiB, memory.current), 서버 전체 CPU(%), 러너 잡 컨테이너 수
set -euo pipefail
DURATION="${1:-1200}"
NAME="${2:-a301-dev-ai-agent}"
INTERVAL=5

cid=$(docker inspect -f '{{.Id}}' "$NAME")
dir=/sys/fs/cgroup/system.slice/docker-${cid}.scope
if [ ! -f "$dir/cpu.stat" ]; then
  dir=$(dirname "$(find /sys/fs/cgroup -path "*${cid}*" -name cpu.stat 2>/dev/null | head -1)")
fi
[ -f "$dir/cpu.stat" ] || { echo "FAIL: cgroup v2 cpu.stat을 찾지 못했다" >&2; exit 1; }

usage() { awk '/^usage_usec/{print $2}' "$dir/cpu.stat"; }
host() { awk '/^cpu /{idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print total, idle}' /proc/stat; }

echo "# image=$(docker inspect -f '{{.Config.Image}}' "$NAME") started=$(docker inspect -f '{{.State.StartedAt}}' "$NAME") nproc=$(nproc)"
echo "time,agent_cores,agent_mem_mib,host_cpu_pct,ci_containers"
prev_u=$(usage); prev_t=$(date +%s%N); read -r prev_ht prev_hi < <(host)
end=$(( $(date +%s) + DURATION ))
while [ "$(date +%s)" -lt "$end" ]; do
  sleep "$INTERVAL"
  u=$(usage); t=$(date +%s%N); read -r ht hi < <(host)
  mem=$(awk '{printf "%.0f", $1/1048576}' "$dir/memory.current")
  # GitLab 러너가 띄운 잡 컨테이너 수. 0이 아닌 구간은 서버 전체 CPU에 CI가 섞인다
  ci=$(docker ps --format '{{.Names}}' | grep -c '^runner-' || true)
  awk -v du=$((u - prev_u)) -v dt=$((t - prev_t)) -v dht=$((ht - prev_ht)) -v dhi=$((hi - prev_hi)) \
      -v ts="$(date +%H:%M:%S)" -v mem="$mem" -v ci="$ci" \
      'BEGIN { printf "%s,%.3f,%s,%.1f,%s\n", ts, du / (dt / 1000), mem, (dht ? 100 * (dht - dhi) / dht : 0), ci }'
  prev_u=$u; prev_t=$t; prev_ht=$ht; prev_hi=$hi
done
