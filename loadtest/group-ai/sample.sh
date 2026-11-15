#!/bin/sh
# 면접 에이전트 컨테이너의 CPU · 메모리를 cgroup v2로 직접 읽어 5초마다 CSV로 출력한다(report/group-ai-2026-11-15.md).
# agent-cpu/sample.sh와 같은 방식이다. docker stats · docker exec는 그 프로세스의 CPU가 측정값에 섞이므로 사용하지 않는다.
# Docker Desktop은 cgroup이 Linux VM 안에 있으므로, 호스트 cgroup을 읽기 전용으로 연결한 작은 컨테이너에서 실행한다.
#   cid=$(docker inspect -f '{{.Id}}' g528-agent)
#   MSYS_NO_PATHCONV=1 docker run --rm --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:ro -v "$PWD/loadtest/group-ai:/w:ro" \
#     alpine sh /w/sample.sh "$cid" 1800 > loadtest/results/group-ai/agent-cpu.csv
# 출력: 시각(UTC, 초), 에이전트 코어(5초 평균), 에이전트 메모리(MiB), Docker VM 전체 CPU(%),
#   VM 메모리 압박(PSI some avg10, %), VM 스왑 사용(MiB).
# VM 전체 CPU에는 브라우저(발생기) · LiveKit · Egress가 함께 포함된다. 80%를 넘거나 메모리 압박 · 스왑이 발생한 회차는
# 측정 PC 부하로 에이전트 측정값이 왜곡되었을 수 있으므로 보조 자료로 분류한다(load_test_plan 3.2).
set -eu
CID="$1"
DURATION="${2:-1800}"
INTERVAL=5

dir=$(dirname "$(find /sys/fs/cgroup -path "*${CID}*" -name cpu.stat 2>/dev/null | head -1)")
[ -f "$dir/cpu.stat" ] || { echo "FAIL: cgroup v2 cpu.stat을 찾지 못했다" >&2; exit 1; }

usage() { awk '/^usage_usec/{print $2}' "$dir/cpu.stat"; }
vm() { awk '/^cpu /{idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print total, idle}' /proc/stat; }
psi() { awk '/^some/{split($2, a, "="); print a[2]}' /proc/pressure/memory; }
swap() { awk '/^SwapTotal/{t=$2} /^SwapFree/{f=$2} END{printf "%.0f", (t - f) / 1024}' /proc/meminfo; }

echo "# cgroup=$dir nproc=$(nproc)"
echo "time,agent_cores,agent_mem_mib,vm_cpu_pct,vm_mem_pressure_avg10,vm_swap_used_mib"
prev_u=$(usage); prev_t=$(date +%s); set -- $(vm); prev_vt=$1; prev_vi=$2
end=$(( $(date +%s) + DURATION ))
while [ "$(date +%s)" -lt "$end" ]; do
  sleep "$INTERVAL"
  u=$(usage); t=$(date +%s); set -- $(vm); vt=$1; vi=$2
  mem=$(awk '{printf "%.0f", $1/1048576}' "$dir/memory.current")
  awk -v du=$((u - prev_u)) -v dt=$((t - prev_t)) -v dvt=$((vt - prev_vt)) -v dvi=$((vi - prev_vi)) -v ts="$t" -v mem="$mem" \
      -v p="$(psi)" -v s="$(swap)" \
      'BEGIN { printf "%s,%.3f,%s,%.1f,%s,%s\n", ts, du / (dt * 1000000), mem, (dvt ? 100 * (dvt - dvi) / dvt : 0), p, s }'
  prev_u=$u; prev_t=$t; prev_vt=$vt; prev_vi=$vi
done
