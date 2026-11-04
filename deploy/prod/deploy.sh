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
# 6. 확인: 모든 서비스 실행 · healthy, BE · FE · AI HTTP 상태, 바깥 주소(Cloudflare Tunnel → Nginx → FE)
# 7. 이미지 정리: 서비스마다 최신 3개만 남긴다(8.2)
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
COMPOSE=(docker compose -f "${PROD_DIR}/compose.yml")
SRC_COMPOSE=(docker compose -f "${SRC_DIR}/compose.yml")

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
# 이미지 · 환경 변수 · 설정 해시 라벨이 바뀐 서비스만 다시 만든다(compose가 Recreate로 출력한다)
"${COMPOSE[@]}" up -d --remove-orphans

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

# 바깥 주소로 한 바퀴(Cloudflare → Tunnel → Nginx → FE). 터널 연결은 이 확인으로 본다.
# cloudflared 로그의 「Registered tunnel connection」은 컨테이너를 다시 만들지 않은 배포에서는 예전 기동 때 줄이라 지금 연결을 뜻하지 않고,
# 로그가 회전되면 연결이 멀쩡해도 없어서 확인 기준으로 쓰지 않는다. 실패하면 cloudflared · Nginx 로그를 남긴다
public_ok=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 10 "${PUBLIC_URL}/api/health" 2>/dev/null | grep -q '"UP"'; then public_ok=1; break; fi
  sleep 2
done
if [ "$public_ok" -ne 1 ]; then
  echo "---- a301-prod-cloudflared 로그"; docker logs --tail 40 a301-prod-cloudflared 2>&1 || true
  echo "---- a301-prod-nginx 로그"; "${COMPOSE[@]}" logs --tail 40 a301-prod-nginx || true
  fail "${PUBLIC_URL}/api/health가 UP이 아닙니다(터널 연결 · CLOUDFLARE_TUNNEL_TOKEN · Nginx 확인)."
fi
echo "OK: ${PUBLIC_URL} (Cloudflare Tunnel · Nginx)"

log "이미지 정리 (서비스마다 최신 ${KEEP_IMAGES}개)"
# docker image ls는 만든 시각이 최신인 것부터 보여 준다. 돌고 있는 컨테이너의 이미지는 docker rmi가 거부해 남는다
for svc in be fe ai admin; do
  docker image ls "$DOCKERHUB_REPO" --format '{{.Tag}} {{.ID}}' \
    | awk -v p="${svc}-" 'index($1, p) == 1 && !seen[$2]++ { print $2 }' \
    | tail -n +"$((KEEP_IMAGES + 1))" | xargs -r docker rmi >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null

log "OK: 운영 배포 완료 (${IMAGE_TAG})"
