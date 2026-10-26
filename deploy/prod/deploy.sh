#!/usr/bin/env bash
# 운영 서버 배포(배포 계획 8장). CI prod-deploy 잡이 Lightsail 러너(a301-prod, shell)에서 레포 루트 기준으로 실행한다.
#   IMAGE_TAG=<커밋 짧은 SHA> bash deploy/prod/deploy.sh
# 비밀값은 CI/CD Variables가 환경 변수로 넣는다(배포 계획 7장). compose가 빠진 값을 이름과 함께 알려 주고 멈춘다.
#
# 순서
# 1. Docker Hub 로그인(pull 토큰, 임시 폴더. 끝나면 로그아웃하고 지운다)
# 2. 배포 파일을 /opt/a301/prod로 복사. 설정 파일이 바뀐 서비스는 기억해 둔다
# 3. 백업 준비: backup.sh 복사, S3 키 파일(backup.env, 600) 쓰기
# 4. pull → up -d. 설정 파일만 바뀐 서비스는 다시 시작한다
# 5. 확인: 모든 서비스 실행 · healthy, BE · FE · AI HTTP 상태, 터널 연결, 바깥 주소
# 6. 이미지 정리: 서비스마다 최신 3개만 남긴다(8.2)
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG가 필요합니다}"
: "${DOCKERHUB_PULL_TOKEN:?DOCKERHUB_PULL_TOKEN이 필요합니다(범위 prod/*, master에서만 읽힘)}"
export IMAGE_TAG

DOCKERHUB_USER="${DOCKERHUB_USER:-hanggeut}"
DOCKERHUB_REPO="${DOCKERHUB_REPO:-hanggeut/a301}"
PROD_DIR="${PROD_DIR:-/opt/a301/prod}"
BACKUP_HOME="/opt/a301"
KEEP_IMAGES="${KEEP_IMAGES:-3}"
PUBLIC_URL="${PUBLIC_URL:-https://hangguet.co.kr}"
COMPOSE=(docker compose -f "${PROD_DIR}/compose.yml")

log() { echo "== $*"; }
fail() { echo "FAIL: $*"; exit 1; }

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

# 설정 파일 → 그 파일을 쓰는 서비스. 파일 하나를 붙인 컨테이너는 파일이 바뀌어도 compose가 다시 만들지 않으므로
# 바뀐 서비스만 직접 다시 시작한다(LiveKit을 매번 다시 시작하면 진행 중인 면접이 끊기기 때문)
declare -A CONFIG_SERVICE=(
  [livekit.yaml]=a301-prod-livekit
  [nginx.conf]=a301-prod-nginx
  [prometheus.yml]=a301-prod-prometheus
  [blackbox.yml]=a301-prod-blackbox
  [loki.yml]=a301-prod-loki
  [alloy.alloy]=a301-prod-alloy
  [grafana]=a301-prod-grafana
)
checksum() {
  # 파일이나 폴더 내용의 해시. 없으면 빈 문자열
  if [ -e "$1" ]; then find "$1" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1; fi
}

log "배포 파일 복사 → ${PROD_DIR}"
declare -A BEFORE=()
for path in "${!CONFIG_SERVICE[@]}"; do BEFORE[$path]="$(checksum "${PROD_DIR}/${path}")"; done
mkdir -p "$PROD_DIR"
rsync -a --delete deploy/prod/ "${PROD_DIR}/"
CHANGED=()
for path in "${!CONFIG_SERVICE[@]}"; do
  if [ -n "${BEFORE[$path]}" ] && [ "${BEFORE[$path]}" != "$(checksum "${PROD_DIR}/${path}")" ]; then
    CHANGED+=("${CONFIG_SERVICE[$path]}")
  fi
done

log "백업 준비"
install -m 750 "${PROD_DIR}/backup.sh" "${BACKUP_HOME}/backup.sh"
(
  umask 077
  {
    echo "AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID가 필요합니다}"
    echo "AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY가 필요합니다}"
    echo "AWS_DEFAULT_REGION=ap-northeast-2"
  } > "${BACKUP_HOME}/backup.env"
)

log "이미지 받기 (${IMAGE_TAG})"
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" pull --quiet

log "서비스 띄우기"
"${COMPOSE[@]}" up -d --remove-orphans
if [ "${#CHANGED[@]}" -gt 0 ]; then
  log "설정이 바뀐 서비스 다시 시작: ${CHANGED[*]}"
  "${COMPOSE[@]}" restart "${CHANGED[@]}"
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

# Cloudflare Tunnel이 붙어야 바깥에서 들어온다
for _ in $(seq 1 30); do
  if docker logs a301-prod-cloudflared 2>&1 | grep -q 'Registered tunnel connection'; then echo "OK: Cloudflare Tunnel 연결"; break; fi
  sleep 2
done
docker logs a301-prod-cloudflared 2>&1 | grep -q 'Registered tunnel connection' \
  || { docker logs --tail 40 a301-prod-cloudflared || true; fail "Cloudflare Tunnel이 연결되지 않았습니다(CLOUDFLARE_TUNNEL_TOKEN 확인)."; }

# 바깥 주소로 한 바퀴(Cloudflare → Tunnel → Nginx → FE)
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "${PUBLIC_URL}/api/health" 2>/dev/null | grep -q '"UP"'; then echo "OK: ${PUBLIC_URL}"; break; fi
  sleep 2
done
curl -fsS --max-time 10 "${PUBLIC_URL}/api/health" 2>/dev/null | grep -q '"UP"' \
  || fail "${PUBLIC_URL}/api/health가 UP이 아닙니다(터널 경로 · Nginx 확인)."

log "이미지 정리 (서비스마다 최신 ${KEEP_IMAGES}개)"
# docker image ls는 만든 시각이 최신인 것부터 보여 준다. 돌고 있는 컨테이너의 이미지는 docker rmi가 거부해 남는다
for svc in be fe ai admin; do
  docker image ls "$DOCKERHUB_REPO" --format '{{.Tag}} {{.ID}}' \
    | awk -v p="${svc}-" 'index($1, p) == 1 && !seen[$2]++ { print $2 }' \
    | tail -n +"$((KEEP_IMAGES + 1))" | xargs -r docker rmi >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null

log "OK: 운영 배포 완료 (${IMAGE_TAG})"
