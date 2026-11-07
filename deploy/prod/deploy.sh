#!/usr/bin/env bash
# 운영 서버 배포(배포 계획 8장). CI prod-deploy 잡이 Lightsail 러너(a301-prod, shell)에서 레포 루트 기준으로 실행한다.
#   IMAGE_TAG=<커밋 짧은 SHA> bash deploy/prod/deploy.sh
# 비밀값은 CI/CD Variables가 환경 변수로 넣는다(배포 계획 7장). compose가 빠진 값을 이름과 함께 알려 주고 멈춘다.
#
# 순서
# 1. 설정 파일 해시를 A301_*_CONFIG_HASH로 넘긴다(compose가 라벨 a301.config-hash로 붙인다)
# 2. Docker Hub 로그인(pull 토큰, 임시 폴더. 끝나면 로그아웃하고 지운다)
# 3. 체크아웃의 compose로 설정 검사 · pull. 여기까지 실패하면 서버는 예전 그대로다
# 4. 백업 준비: backup.sh 복사, S3 키 파일(backup.env, 600) 쓰기
# 5. 배포 파일을 /opt/a301/prod로 복사 → up -d. 이미지 · 환경 변수 · 설정 해시가 바뀐 서비스만 compose가 다시 만든다
#    Redis만 다시 만들어지면 BE를 다시 시작한다(예전 Redis IP를 붙잡기 때문)
# 6. 확인: 모든 서비스 실행 · healthy, BE · FE · AI HTTP 상태, 바깥 주소 3개(앱 · LiveKit · Grafana),
#    서버 443 · 80 직접 접속(같은 3개 + TURN/TLS SNI 분기 + http → https), 20초 동안 재시작 없음
# 7. 이미지 정리: 서비스마다 최신 3개만 남긴다(8.2)
# AGENT_ASG_ENABLED=true면 compose.asg.yml을 더하고 메인 서버 에이전트를 내린다(에이전트 ASG 전환, 이해준/agent_autoscale_plan 10.1)
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG가 필요합니다}"
: "${DOCKERHUB_PULL_TOKEN:?DOCKERHUB_PULL_TOKEN이 필요합니다(범위 prod/*, master에서만 읽힘)}"
export IMAGE_TAG

DOCKERHUB_USER="${DOCKERHUB_USER:-hanggeut}"
DOCKERHUB_REPO="${DOCKERHUB_REPO:-hanggeut/a301}"
SRC_DIR="deploy/prod"
PROD_DIR="${PROD_DIR:-/opt/a301/prod}"
BACKUP_HOME="/opt/a301"
KEEP_IMAGES="${KEEP_IMAGES:-3}"
PUBLIC_URL="${PUBLIC_URL:-https://hangguet.co.kr}"
RTC_URL="${RTC_URL:-https://rtc.hangguet.co.kr}"
GRAFANA_URL="${GRAFANA_URL:-https://grafana.hangguet.co.kr}"
STABLE_WAIT="${STABLE_WAIT:-20}"
COMPOSE=(docker compose -f "${PROD_DIR}/compose.yml")
SRC_COMPOSE=(docker compose -f "${SRC_DIR}/compose.yml")

# 에이전트 ASG 전환(이해준/agent_autoscale_plan 10.1의 5). GitLab 변수 AGENT_ASG_ENABLED=true면 compose.asg.yml을 더해
# 메인 서버의 에이전트를 끄고 LiveKit · Redis · Prometheus · Loki를 Tailscale IP에 연다. 변수를 지우고 다시 배포하면 원래 구성이다.
# 진행 중 면접이 끝날 때까지 기다리는 상한(초). ASG 인스턴스의 drain 상한과 같다(그룹 면접 약 60분을 덮는다, 계획 6.3)
AGENT_DRAIN_SECONDS="${AGENT_DRAIN_SECONDS:-3900}"
if [ "${AGENT_ASG_ENABLED:-}" = "true" ]; then
  : "${MAIN_TAILSCALE_IP:?AGENT_ASG_ENABLED=true면 MAIN_TAILSCALE_IP(메인 서버 Tailscale IP, 범위 prod/*)가 필요합니다}"
  COMPOSE+=(-f "${PROD_DIR}/compose.asg.yml")
  SRC_COMPOSE+=(-f "${SRC_DIR}/compose.asg.yml")
  # Egress는 Egress ASG로 옮기기 전까지 메인 서버에 둔다(compose.asg.yml이 egress-on-main 프로필로 묶는다).
  # Egress를 옮기는 날 EGRESS_ASG_ENABLED=true로 끄고, 그때 아래 에이전트처럼 남은 컨테이너를 drain하는 처리를 더한다
  if [ "${EGRESS_ASG_ENABLED:-}" != "true" ]; then
    export COMPOSE_PROFILES="egress-on-main"
  fi
  echo "에이전트 ASG 구성: 메인 서버 에이전트 끔, Tailscale ${MAIN_TAILSCALE_IP}에 7880 · 6379 · 9090 · 3100"
fi

log() { echo "== $*"; }
fail() { echo "FAIL: $*"; exit 1; }

# 설정 파일(폴더) → 그 파일을 붙인 서비스의 해시 변수 이름(A301_<이름>_CONFIG_HASH, compose.yml 라벨 a301.config-hash).
# 파일 하나를 붙인 컨테이너는 파일이 바뀌어도 compose 설정이 그대로라 up -d가 다시 만들지 않고, 프로세스는 기동할 때 읽은 설정을 계속 쓴다.
# 해시를 라벨로 붙이면 바뀐 서비스만 up -d가 다시 만든다(LiveKit을 매번 다시 띄우면 진행 중인 면접이 끊기기 때문).
# 비교 기준이 컨테이너 라벨이라, 배포가 중간에 실패해도 다음 배포에서 맞춰진다.
# 해시에는 파일 경로도 들어가므로 SRC_DIR 기준 상대 경로로 계산한다. 계산 방식을 바꾸면 7개가 한 번 다시 만들어진다
declare -A CONFIG_HASH_FILE=(
  [NGINX]=nginx.conf
  [LIVEKIT]=livekit.yaml
  [PROMETHEUS]=prometheus.yml
  [BLACKBOX]=blackbox.yml
  [LOKI]=loki.yml
  [ALLOY]=alloy.alloy
  [GRAFANA]=grafana
)
config_hash() {
  (cd "$SRC_DIR" && find "$1" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)
}

# compose 호출(실패 때 on_exit의 ps 포함)보다 먼저 넘긴다. 복사할 파일(SRC_DIR)로 계산하므로 /opt/a301/prod에 놓일 내용과 같다
log "설정 해시"
for name in "${!CONFIG_HASH_FILE[@]}"; do
  file="${CONFIG_HASH_FILE[$name]}"
  [ -e "${SRC_DIR}/${file}" ] || fail "설정 파일이 없습니다: ${SRC_DIR}/${file}(레포 루트에서 실행했는지 확인)"
  value="$(config_hash "$file")"
  export "A301_${name}_CONFIG_HASH=${value}"
  echo "${file}: ${value}"
done

# 실패하면 상태와 로그를 남긴다. 로그인 정보는 성공 · 실패와 관계없이 지운다
DOCKER_CONFIG="$(mktemp -d)"
export DOCKER_CONFIG
on_exit() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -f "${PROD_DIR}/compose.yml" ]; then
    echo "---- 컨테이너 상태"
    "${COMPOSE[@]}" ps -a || true
  fi
  docker logout >/dev/null 2>&1 || true
  rm -rf "$DOCKER_CONFIG"
}
trap on_exit EXIT

log "Docker Hub 로그인 (${DOCKERHUB_USER})"
printf '%s' "$DOCKERHUB_PULL_TOKEN" | docker login -u "$DOCKERHUB_USER" --password-stdin >/dev/null

# 검사 · 이미지 받기 · 백업 준비는 체크아웃(SRC_DIR)의 파일로 먼저 한다. 서버의 배포 파일(PROD_DIR)은 그다음 바로 up -d 직전에 바꾼다.
# 여기서 실패하면 서버의 설정 파일 · 컨테이너가 모두 예전 그대로 남는다. 먼저 복사해 두면 예전 컨테이너가 재시작될 때
# 새 설정 파일을 읽어 예전 이미지와 새 설정이 섞인다. pull은 이미지만 받으므로 compose 파일 위치와 관계없다
log "설정 검사 · 이미지 받기 (${IMAGE_TAG})"
"${SRC_COMPOSE[@]}" config --quiet
"${SRC_COMPOSE[@]}" pull --quiet

log "백업 준비"
install -m 750 "${SRC_DIR}/backup.sh" "${BACKUP_HOME}/backup.sh"
(
  umask 077
  {
    echo "AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID가 필요합니다}"
    echo "AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY가 필요합니다}"
    echo "AWS_DEFAULT_REGION=ap-northeast-2"
  } > "${BACKUP_HOME}/backup.env"
)

log "배포 파일 복사 → ${PROD_DIR}"
mkdir -p "$PROD_DIR"
rsync -a --delete "${SRC_DIR}/" "${PROD_DIR}/"

log "서비스 띄우기"
# BE가 붙는 저장소(Redis · PostgreSQL)가 다시 만들어지는지 보려고 up 전의 컨테이너 ID를 적어 둔다(아래 BE 다시 시작)
BE_DEPS=(a301-prod-redis a301-prod-postgres)
declare -A dep_before=()
for dep in "${BE_DEPS[@]}"; do
  dep_before[$dep]="$(docker inspect -f '{{.Id}}' "$dep" 2>/dev/null || true)"
done
# 이미지 · 환경 변수 · 설정 해시 라벨이 바뀐 서비스만 다시 만든다(compose가 Recreate로 출력한다)
"${COMPOSE[@]}" up -d --remove-orphans

# 저장소만 다시 만들어지고 BE는 그대로 남으면, BE가 예전 IP로 계속 다시 붙으려 해 그 저장소를 못 쓴다
# (11/07 운영 전환: AGENT_ASG_ENABLED로 Redis 포트만 바뀌어 Redis만 새로 만들어졌고 BE(Lettuce)가 약 7분 동안 Redis에 붙지 못했다).
# AI 작업자(Python) · LiveKit · Egress(Go)는 다시 붙을 때 이름을 새로 찾아 스스로 복구한다.
# PostgreSQL(JDBC)은 같은 일을 겪지 않았지만 확인하지 않았으므로 같이 본다. 저장소보다 BE가 먼저 떠 있으면 BE를 다시 시작한다.
# 저장소 설정이 바뀌는 배포(이미지 · 설정 · 포트 · AGENT_ASG_ENABLED 켜고 끄기)마다 해당한다
be_started="$(docker inspect -f '{{.State.StartedAt}}' a301-prod-be)"
for dep in "${BE_DEPS[@]}"; do
  after="$(docker inspect -f '{{.Id}}' "$dep" 2>/dev/null || true)"
  [ -n "${dep_before[$dep]}" ] && [ "${dep_before[$dep]}" != "$after" ] || continue
  dep_started="$(docker inspect -f '{{.State.StartedAt}}' "$dep")"
  # 같은 형식(RFC 3339, UTC)이라 문자열 비교가 시각 비교다
  if [[ "$be_started" < "$dep_started" ]]; then
    log "${dep}가 다시 만들어져 BE 다시 시작 (${dep} ${dep_started}, BE ${be_started})"
    docker restart a301-prod-be >/dev/null
    echo "OK: a301-prod-be 다시 시작"
    break
  fi
done

# 프로필로 꺼진 서비스의 컨테이너는 up이 지우지 않는다. 전환하는 날 남아 있는 메인 서버 에이전트를 SIGTERM으로 drain한 뒤 지운다
# (새 면접은 받지 않고 진행 중 면접을 마친 뒤 내려간다. 그동안 새 면접은 ASG 에이전트가 받는다)
if [ "${AGENT_ASG_ENABLED:-}" = "true" ] && docker container inspect a301-prod-ai-agent >/dev/null 2>&1; then
  log "메인 서버 에이전트 내리기 (진행 중 면접을 최대 ${AGENT_DRAIN_SECONDS}초 기다림)"
  docker stop --time "$AGENT_DRAIN_SECONDS" a301-prod-ai-agent >/dev/null
  docker rm a301-prod-ai-agent >/dev/null
  echo "OK: a301-prod-ai-agent 내림"
  # Prometheus는 에이전트를 이름(DNS)으로 찾는데, 켜진 뒤에 컨테이너가 사라지면 이름 찾기가 실패해도 예전 대상을 붙잡아
  # up=0과 "지표 수집 실패" 알림이 남는다(11/07, 로컬에서 재현). 다시 시작하면 대상 없이 뜬다. 지표는 볼륨에 남는다
  docker restart a301-prod-prometheus >/dev/null
  echo "OK: a301-prod-prometheus 다시 시작(꺼진 에이전트 대상 지우기)"
fi

log "상태 확인"
EXPECTED="$("${COMPOSE[@]}" config --services | sort)"
healthy=0
for _ in $(seq 1 90); do
  running="$("${COMPOSE[@]}" ps --services --status running | sort)"
  # healthcheck가 있는 서비스는 healthy여야 한다(starting · unhealthy면 기다림)
  waiting="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$2 == "starting" || $2 == "unhealthy" { print $1 }')"
  if [ "$running" = "$EXPECTED" ] && [ -z "$waiting" ]; then healthy=1; break; fi
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  echo "실행 중이 아닌 서비스: $(comm -23 <(echo "$EXPECTED") <(echo "$running") | tr '\n' ' ')"
  echo "준비되지 않은 서비스: ${waiting//$'\n'/ }"
  for svc in $(comm -23 <(echo "$EXPECTED") <(echo "$running")) $waiting; do
    echo "---- ${svc} 로그"; "${COMPOSE[@]}" logs --tail 60 "$svc" || true
  done
  fail "180초 안에 모든 서비스가 준비되지 않았습니다."
fi

# 재시작 반복 확인의 기준. healthcheck가 없는 서비스(livekit · egress · prometheus · loki · alloy · grafana · cloudflared · exporter 등)는
# 설정이 틀려 뜨자마자 죽어도 restart로 다시 떠, 위 확인이 running인 순간을 보면 통과한다.
# 여기서 재시작 수를 적어 두고, 아래 HTTP 확인이 끝난 뒤 STABLE_WAIT초가 지났을 때 다시 본다(개발 모니터링 잡과 같은 확인)
restart_counts() {
  # <컨테이너> <실행 중> <재시작 수>
  "${COMPOSE[@]}" ps -a -q | xargs -r docker inspect -f '{{.Name}} {{.State.Running}} {{.RestartCount}}' | sed 's#^/##' | sort
}
STABLE_FROM=$SECONDS
BASELINE="$(restart_counts)"

# 상태 확인 포트는 루프백에만 열려 있다(compose.yml)
check_http() {
  local name="$1" url="$2"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 5 "$url" 2>/dev/null | grep -q '"UP"'; then echo "OK: ${name}"; return 0; fi
    sleep 2
  done
  echo "---- ${name} 로그"; "${COMPOSE[@]}" logs --tail 80 "$3" || true
  fail "${name}가 120초 안에 UP이 되지 않았습니다 (${url})"
}
check_http "BE" "http://127.0.0.1:18084/actuator/health" a301-prod-be
check_http "FE" "http://127.0.0.1:18082/api/health" a301-prod-fe
check_http "AI" "http://127.0.0.1:18083/health" a301-prod-ai

# 바깥 주소로 한 바퀴. 도메인 3개를 모두 본다(배포 계획 5.1). DNS가 Tunnel을 가리키는 동안은 터널 연결도 이 확인으로 본다.
# cloudflared 로그의 「Registered tunnel connection」은 컨테이너를 다시 만들지 않은 배포에서는 예전 기동 때 줄이라 지금 연결을 뜻하지 않고,
# 로그가 회전되면 연결이 멀쩡해도 없어서 확인 기준으로 쓰지 않는다. 또 pipefail에서 `docker logs | grep -q`는 로그가 길면
# grep이 줄을 찾고 먼저 끝나 docker logs가 SIGPIPE(141)로 죽어, 줄이 있어도 실패가 된다(10/29 무렵 배포가 이것으로 실패).
# 아래 curl | grep은 응답이 수백 바이트라 curl이 먼저 다 쓰고 끝나므로 이 문제가 없다. 실패하면 cloudflared와 그 경로 서비스의 로그를 남긴다
# check_public <이름> <주소> <응답에 있어야 할 패턴(grep -E)> <로그를 남길 서비스...>
check_public() {
  local name="$1" url="$2" pattern="$3"
  shift 3
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 10 "$url" 2>/dev/null | grep -Eq "$pattern"; then echo "OK: ${name} (${url})"; return 0; fi
    sleep 2
  done
  for svc in a301-prod-cloudflared "$@"; do
    echo "---- ${svc} 로그"; "${COMPOSE[@]}" logs --tail 40 "$svc" || true
  done
  fail "${name}가 120초 안에 응답하지 않았습니다(${url}). DNS가 가리키는 곳(Tunnel이면 터널 연결 · CLOUDFLARE_TUNNEL_TOKEN) · 해당 서비스를 확인하세요."
}
# 앱: DNS가 가리키는 길(Tunnel이면 Cloudflare → Tunnel → Nginx:80, 직접이면 서버 443 → Nginx) → FE
check_public "바깥 주소" "${PUBLIC_URL}/api/health" '"UP"' a301-prod-nginx
# 면접방 시그널링: 브라우저가 LiveKit에 붙는 경로. LiveKit은 /에 OK로 답한다
check_public "LiveKit 바깥 주소" "${RTC_URL}/" '^OK$' a301-prod-livekit
# 대시보드: 장애를 보려면 떠 있어야 한다
check_public "Grafana 바깥 주소" "${GRAFANA_URL}/api/health" '"database": *"ok"' a301-prod-grafana

# 서버 443 · 80으로 직접(DNS · Cloudflare를 거치지 않고) 한 바퀴. 서버 안에서 127.0.0.1로 붙되 도메인 이름(SNI · Host)은 진짜로 보낸다.
# DNS가 아직 Tunnel을 가리켜도, 바꾼 뒤에도 사용자가 들어올 길이 살아 있는지 본다(인증서 · SNI 분기 · 각 서비스)
# check_direct <이름> <주소> <응답에 있어야 할 패턴(grep -E)> <로그를 남길 서비스...>
check_direct() {
  local name="$1" url="$2" pattern="$3" host port
  shift 3
  host="$(echo "$url" | sed -E 's#^https?://([^/:]+).*#\1#')"
  case "$url" in https://*) port=443 ;; *) port=80 ;; esac
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 --resolve "${host}:${port}:127.0.0.1" "$url" 2>/dev/null | grep -Eq "$pattern"; then echo "OK: ${name} 직접 (${url})"; return 0; fi
    sleep 2
  done
  for svc in a301-prod-nginx "$@"; do
    echo "---- ${svc} 로그"; "${COMPOSE[@]}" logs --tail 40 "$svc" || true
  done
  fail "${name}가 직접 접속(서버 ${port})으로 60초 안에 응답하지 않았습니다(${url}). Nginx 설정 · 인증서(/etc/letsencrypt/live/${host}) · 해당 서비스를 확인하세요."
}
check_direct "앱" "${PUBLIC_URL}/api/health" '"UP"'
check_direct "LiveKit" "${RTC_URL}/" '^OK$' a301-prod-livekit
check_direct "Grafana" "${GRAFANA_URL}/api/health" '"database": *"ok"' a301-prod-grafana
# TURN/TLS: 443에 turn 이름으로 붙으면 Nginx가 아니라 LiveKit이 TURN 인증서로 답해야 한다(SNI 분기 확인)
turn_subject="$(openssl s_client -connect 127.0.0.1:443 -servername turn.hangguet.co.kr </dev/null 2>/dev/null | openssl x509 -noout -subject 2>/dev/null || true)"
if echo "$turn_subject" | grep -q 'turn\.hangguet\.co\.kr'; then
  echo "OK: TURN/TLS 직접 (443, ${turn_subject})"
else
  echo "---- a301-prod-livekit 로그"; "${COMPOSE[@]}" logs --tail 40 a301-prod-livekit || true
  fail "443에 turn.hangguet.co.kr로 붙었을 때 TURN 인증서가 오지 않았습니다(받은 것: ${turn_subject:-없음}). nginx.conf stream 분기 · LiveKit TURN을 확인하세요."
fi
# http → https: 서버 80은 https 주소로 보내야 한다
redirect="$(curl -sS -o /dev/null --max-time 5 -w '%{http_code} %header{location}' --resolve "hangguet.co.kr:80:127.0.0.1" http://hangguet.co.kr/ 2>/dev/null || true)"
if [ "$redirect" = "301 https://hangguet.co.kr/" ]; then
  echo "OK: http → https (${redirect})"
else
  fail "서버 80이 https로 보내지 않습니다(받은 것: ${redirect:-없음}). nginx.conf의 8080 서버를 확인하세요."
fi

log "재시작 반복 확인 (${STABLE_WAIT}초)"
left=$((STABLE_WAIT - (SECONDS - STABLE_FROM)))
if [ "$left" -gt 0 ]; then sleep "$left"; fi
NOW="$(restart_counts)"
# 기준과 달라졌거나(재시작 수 증가 · 멈춤) 지금 실행 중이 아닌 컨테이너
unstable="$( { comm -13 <(echo "$BASELINE") <(echo "$NOW"); echo "$NOW" | awk '$2 != "true"'; } | awk '{ print $1 }' | sort -u)"
if [ -n "$unstable" ]; then
  echo "---- 컨테이너 상태(이름 · 실행 중 · 재시작 수)"
  echo "기준: ${BASELINE//$'\n'/, }"
  echo "지금: ${NOW//$'\n'/, }"
  for name in $unstable; do
    echo "---- ${name} 로그"; docker logs --tail 60 "$name" 2>&1 || true
  done
  fail "다시 시작을 반복하거나 멈춘 컨테이너가 있습니다: ${unstable//$'\n'/ } (설정 파일 · 환경 변수 확인)"
fi
echo "OK: 모든 컨테이너가 ${STABLE_WAIT}초 넘게 재시작 없이 실행 중"

log "이미지 정리 (서비스마다 최신 ${KEEP_IMAGES}개)"
# docker image ls는 만든 시각이 최신인 것부터 보여 준다. 돌고 있는 컨테이너의 이미지는 docker rmi가 거부해 남는다
for svc in be fe ai admin; do
  docker image ls "$DOCKERHUB_REPO" --format '{{.Tag}} {{.ID}}' \
    | awk -v p="${svc}-" 'index($1, p) == 1 && !seen[$2]++ { print $2 }' \
    | tail -n +"$((KEEP_IMAGES + 1))" | xargs -r docker rmi >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null

log "OK: 운영 배포 완료 (${IMAGE_TAG})"
