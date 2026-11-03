#!/usr/bin/env bash
# S5 동시 화상 면접을 단계별로 차례로 돌린다(load_test_plan 6장). 로컬 PC(Git Bash)에서 레포 루트나 loadtest에서 실행한다.
#   bash loadtest/s5-levels.sh                       # 동시 1 · 3 · 5 · 8 · 10건
#   LEVELS="1 3" COOLDOWN=60 bash loadtest/s5-levels.sh
#
# 단계마다
# 1. N=<단계> run.sh scenarios/s5-interview-browser.js → results/s5-N<단계>.log
# 2. 그동안 발생기(k6 Docker 컨테이너) CPU · 메모리를 15초마다 기록 → results/s5-N<단계>-generator.txt(발생기가 먼저 막히면 그 단계는 쓰지 않는다, 3.2)
# 3. 끝나면 그 구간의 서버 자원 요약(server/resources.sh) → results/s5-N<단계>-resources.txt
# 4. COOLDOWN초 쉬어 결과 · 합치기 대기열과 CPU가 가라앉게 한다
# 면접이나 다시보기(녹화)가 하나라도 실패하면(기능 한계, 5.1) 그 단계에서 멈춘다. CONTINUE=1이면 계속 올린다.
# 단계별 시각은 results/s5-levels.tsv(단계 · 시작 · 끝, 유닉스 초)에 쌓인다. 보고서 그래프(report/charts.mjs)에 쓴다.
set -euo pipefail

LOADTEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEVELS="${LEVELS:-1 3 5 8 10}"
COOLDOWN="${COOLDOWN:-120}"
RESULTS="${LOADTEST_DIR}/results"
mkdir -p "$RESULTS"

monitor_generator() {
  # k6 컨테이너(브라우저 이미지)만 본다. 로컬 k6로 돌리면 컨테이너가 없어 빈 파일이 남는다
  while :; do
    ids="$(docker ps -q --filter ancestor=grafana/k6:2.3.0-with-browser)"
    if [ -n "$ids" ]; then
      printf '%s ' "$(date +%H:%M:%S)"
      # shellcheck disable=SC2086
      docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' $ids | tr '\n' ' '
      echo
    fi
    sleep 15
  done
}

for n in $LEVELS; do
  echo "== 동시 ${n}건 ($(date +%H:%M:%S))"
  monitor_generator > "${RESULTS}/s5-N${n}-generator.txt" 2>/dev/null &
  monitor=$!
  t0=$(date +%s)
  N="$n" bash "${LOADTEST_DIR}/run.sh" scenarios/s5-interview-browser.js > "${RESULTS}/s5-N${n}.log" 2>&1 || true
  t1=$(date +%s)
  kill "$monitor" 2>/dev/null || true
  echo "${n}	${t0}	${t1}" >> "${RESULTS}/s5-levels.tsv"

  grep -E 'msg="계정 .* (완료|실패)' "${RESULTS}/s5-N${n}.log" | sed 's/.*msg="//; s/" source=.*//' || true
  minutes=$(( (t1 - t0 + 59) / 60 ))
  bash "${LOADTEST_DIR}/server/ssh.sh" "bash ~/a301/loadtest/server/resources.sh ${minutes}m ${t1}" > "${RESULTS}/s5-N${n}-resources.txt" 2>&1 || true
  head -3 "${RESULTS}/s5-N${n}-resources.txt" | tail -2
  echo "발생기 최대: $(sort -k2 -t' ' -rn "${RESULTS}/s5-N${n}-generator.txt" 2>/dev/null | head -1)"

  failed=$(grep -oE "(interview|replay)_failed[^0-9]*[0-9]+" "${RESULTS}/s5-N${n}.log" | grep -oE "[0-9]+$" | awk '{s+=$1} END {print s+0}' || true)
  if [ "${failed:-0}" -gt 0 ] && [ "${CONTINUE:-0}" != "1" ]; then
    echo "동시 ${n}건에서 면접 · 다시보기 ${failed}건 실패: 기능 한계라 여기서 멈춘다(CONTINUE=1이면 계속)"
    break
  fi
  [ "$n" = "${LEVELS##* }" ] || sleep "$COOLDOWN"
done
echo "단계별 시각: ${RESULTS}/s5-levels.tsv"
