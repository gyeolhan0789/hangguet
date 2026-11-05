#!/bin/bash
# ASG 인스턴스 감시 스크립트(이해준/agent_autoscale_plan 6.1 · 6.3 · 6.5). 에이전트 · Egress 인스턴스가 같은 파일을 쓴다.
# bootstrap.sh가 /usr/local/bin/a301-watcher로 깔고 systemd(a301-watcher.service)로 띄운다. 설정은 /etc/a301/watcher.env
#
# 15초마다
#   수명 주기: IMDS target-lifecycle-state가 Terminated면 컨테이너를 SIGTERM으로 멈추고(진행 중 면접 · 녹화가 끝날 때까지,
#             최대 DRAIN_SECONDS) 수명 주기 훅을 완료한다
# 1분마다
#   축소 보호: 진행 중 면접(에이전트) · 녹화(Egress) 수가 1 이상이면 켜고 0이면 끈다. 바뀔 때만 API를 부른다
#   준비 확인: Tailscale · LiveKit 시그널링 · Redis(인증 · PING) · 컨테이너 상태 포트를 보고,
#             FAIL_LIMIT번 연속 실패하면 인스턴스를 비정상으로 알린다(ASG가 바꿔 띄운다)
set -uo pipefail

# shellcheck disable=SC1091
. /etc/a301/watcher.env
REDIS_PASSWORD="$(cat /etc/a301/redis-password 2>/dev/null || true)"

TICK=15
CHECK_EVERY=4
FAIL_LIMIT=5

log() { echo "$(date -Is) $*"; }

imds() {
  local token
  token=$(curl -sf -X PUT http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60') || return 1
  curl -sf -H "X-aws-ec2-metadata-token: ${token}" "http://169.254.169.254/latest/meta-data/$1"
}

asg() { aws autoscaling --region "$REGION" "$@"; }

# ASG가 띄운 인스턴스가 아니면(직접 띄운 시험용) 비어 있고, ASG API는 부르지 않는다
find_asg_name() {
  local name
  name=$(asg describe-auto-scaling-instances --instance-ids "$INSTANCE_ID" \
    --query 'AutoScalingInstances[0].AutoScalingGroupName' --output text 2>/dev/null) || return 1
  [ "$name" = "None" ] && name=""
  echo "$name"
}

# 진행 중 면접 · 녹화 수. 지표를 받지 못하면 unknown(축소 보호를 바꾸지 않는다)
active_count() {
  local body
  body=$(curl -sf --max-time 3 "$METRICS_URL") || { echo unknown; return; }
  # 에이전트: a301_agent_active_interviews 2.0, Egress: livekit_egress_requests{type="Track"} 3
  # 녹화가 한 번도 없었던 Egress는 줄이 없으므로 0이다
  awk -v m="$METRIC_NAME" '$1 == m || index($1, m "{") == 1 { s += $2 } END { printf "%d\n", s }' <<<"$body"
}

tailscale_ok() { [ "$TAILSCALE" != yes ] || tailscale status --peers=false >/dev/null 2>&1; }

tcp_ok() { timeout 3 bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$1" "$2" 2>/dev/null; }

# 비밀번호에 공백이 없어야 한다(인라인 명령으로 보낸다)
redis_ok() {
  timeout 4 bash -c '
    exec 3<>"/dev/tcp/$1/$2" || exit 1
    if [ -n "$3" ]; then
      printf "AUTH %s\r\n" "$3" >&3
      read -r -t 2 reply <&3 || exit 1
      [[ $reply == +OK* ]] || exit 1
    fi
    printf "PING\r\n" >&3
    read -r -t 2 reply <&3 || exit 1
    [[ $reply == +PONG* ]]' _ "$REDIS_HOST" "$REDIS_PORT" "$REDIS_PASSWORD" 2>/dev/null
}

health_ok() { curl -sf --max-time 3 "$HEALTH_URL" >/dev/null; }

# 실패한 항목 이름을 출력한다. 모두 통과하면 아무것도 출력하지 않는다
failed_checks() {
  tailscale_ok || echo -n "tailscale "
  tcp_ok "$LIVEKIT_HOST" "$LIVEKIT_PORT" || echo -n "livekit "
  redis_ok || echo -n "redis "
  health_ok || echo -n "container "
}

drain() {
  log "종료 신호(Terminated): ${CONTAINER}를 멈춘다. 진행 중 작업이 끝날 때까지 최대 ${DRAIN_SECONDS}초"
  docker stop --time "$DRAIN_SECONDS" "$CONTAINER" >/dev/null 2>&1 || true
  log "${CONTAINER} 종료. 수명 주기 훅 완료"
  if [ -n "$ASG_NAME" ]; then
    asg complete-lifecycle-action --lifecycle-hook-name "$HOOK_NAME" --auto-scaling-group-name "$ASG_NAME" \
      --instance-id "$INSTANCE_ID" --lifecycle-action-result CONTINUE \
      || log "수명 주기 훅 완료 실패. 훅 제한 시간이 지나면 ASG가 종료를 진행한다"
  fi
  exit 0
}

PROTECTED=unknown
protect() {
  local want=$1 flag
  [ "$want" = "$PROTECTED" ] && return
  [ -n "$ASG_NAME" ] || return
  if [ "$want" = on ]; then flag=--protected-from-scale-in; else flag=--no-protected-from-scale-in; fi
  if asg set-instance-protection --instance-ids "$INSTANCE_ID" --auto-scaling-group-name "$ASG_NAME" "$flag" >/dev/null; then
    PROTECTED=$want
    log "축소 보호 ${want}"
  else
    log "축소 보호 ${want} 실패. 다음 확인 때 다시 시도한다"
  fi
}

FAILS=0
REPORTED=no
check_ready() {
  local failed
  failed=$(failed_checks)
  if [ -z "$failed" ]; then
    [ "$FAILS" -gt 0 ] && log "준비 확인 회복(연속 실패 ${FAILS}번 뒤)"
    FAILS=0
    return
  fi
  FAILS=$((FAILS + 1))
  log "준비 확인 실패 ${FAILS}/${FAIL_LIMIT}: ${failed}"
  if [ "$FAILS" -ge "$FAIL_LIMIT" ] && [ "$REPORTED" = no ] && [ -n "$ASG_NAME" ]; then
    # 유예 기간(시작 직후) 안이면 ASG가 무시한다
    if asg set-instance-health --instance-id "$INSTANCE_ID" --health-status Unhealthy --should-respect-grace-period; then
      REPORTED=yes
      log "인스턴스를 비정상으로 알렸다"
    fi
  fi
}

ASG_NAME=""
for _ in 1 2 3 4 5; do
  if ASG_NAME=$(find_asg_name); then break; fi
  sleep 5
done
log "감시 시작 role=${ROLE} container=${CONTAINER} asg=${ASG_NAME:-없음}"

n=0
while true; do
  if [ "$(imds autoscaling/target-lifecycle-state 2>/dev/null)" = "Terminated" ]; then
    drain
  fi
  if [ $((n % CHECK_EVERY)) -eq 0 ]; then
    count=$(active_count)
    if [ "$count" != unknown ]; then
      if [ "$count" -gt 0 ]; then protect on; else protect off; fi
    fi
    check_ready
  fi
  n=$((n + 1))
  sleep "$TICK"
done
