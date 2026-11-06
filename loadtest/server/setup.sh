#!/usr/bin/env bash
# 부하 테스트 서버(EC2, Ubuntu 24.04) 기본 셋팅. 운영 서버와 같게 맞춘다(배포 계획 3.1 · 4.2, load_test_plan 3.1.1).
# 서버에서 한 번 실행한다. 다시 실행해도 이미 된 단계는 건너뛴다.
#   CERTBOT_EMAIL=<알림 받을 메일> CF_DNS_API_TOKEN=<Cloudflare DNS 편집 토큰> sudo -E bash setup.sh
#
# 1. 시간대 Asia/Seoul
# 2. 스왑 4GB, vm.swappiness=10
# 3. Docker Engine + Compose plugin(공식 저장소), 기본 로그 json-file 10MB × 3, ubuntu 계정을 docker 그룹에
# 4. TURN 인증서(turn-lt.hangguet.co.kr): certbot + Cloudflare DNS 플러그인(80번 포트를 열지 않는다), 갱신 뒤 LiveKit 재시작
# 5. 웹 인증서 자리(lt.hangguet.co.kr을 인증서 이름 hangguet.co.kr로): 운영 Nginx 설정이 뜨는 데 필요, 갱신 뒤 Nginx reload
set -euo pipefail

TURN_DOMAIN="${TURN_DOMAIN:-turn-lt.hangguet.co.kr}"
WEB_DOMAIN="${WEB_DOMAIN:-lt.hangguet.co.kr}"
WEB_CERT_NAME="hangguet.co.kr" # 운영 nginx.conf가 읽는 경로 이름(바꾸지 않는다)
SERVER_USER="${SERVER_USER:-ubuntu}"

log() { echo "== $*"; }
[ "$(id -u)" -eq 0 ] || { echo "FAIL: sudo로 실행한다"; exit 1; }

log "시간대"
timedatectl set-timezone Asia/Seoul

log "스왑 4GB"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-a301-swap.conf
sysctl -q -p /etc/sysctl.d/99-a301-swap.conf

log "Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -q
  apt-get install -y -q ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# 운영과 같은 기본 로그 설정. 로그가 디스크를 채우지 않게 한다
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
systemctl restart docker
usermod -aG docker "$SERVER_USER"

# certbot + Cloudflare DNS 플러그인 준비(인증서가 하나라도 없을 때만 토큰이 필요하다)
certbot_ready() {
  : "${CERTBOT_EMAIL:?CERTBOT_EMAIL이 필요합니다}"
  if [ ! -f /root/.secrets/cloudflare.ini ]; then
    : "${CF_DNS_API_TOKEN:?CF_DNS_API_TOKEN이 필요합니다(hangguet.co.kr DNS 편집 권한만)}"
    install -m 700 -d /root/.secrets
    printf 'dns_cloudflare_api_token = %s\n' "$CF_DNS_API_TOKEN" > /root/.secrets/cloudflare.ini
    chmod 600 /root/.secrets/cloudflare.ini
  fi
  command -v certbot >/dev/null 2>&1 || apt-get install -y -q certbot python3-certbot-dns-cloudflare
}
issue_cert() {
  certbot certonly --non-interactive --agree-tos -m "$CERTBOT_EMAIL" \
    --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
    --dns-cloudflare-propagation-seconds 30 "$@"
}

log "TURN 인증서 (${TURN_DOMAIN})"
if [ ! -f "/etc/letsencrypt/live/${TURN_DOMAIN}/fullchain.pem" ]; then
  certbot_ready
  issue_cert -d "$TURN_DOMAIN"
fi

# 운영 Nginx 설정(deploy/prod/nginx.conf)은 /etc/letsencrypt/live/hangguet.co.kr/의 인증서가 없으면 뜨지 않는다(11/06 Cloudflare 프록시 제거).
# 테스트 서버의 웹은 지금도 Tunnel(컨테이너 80)로 받아 이 인증서를 내보낼 일은 없다. 운영 설정을 그대로 쓰려고
# 같은 경로(인증서 이름 hangguet.co.kr)에 테스트 도메인 인증서를 받아 둔다
log "웹 인증서 자리 (/etc/letsencrypt/live/${WEB_CERT_NAME})"
if [ ! -f "/etc/letsencrypt/live/${WEB_CERT_NAME}/fullchain.pem" ]; then
  certbot_ready
  issue_cert --cert-name "$WEB_CERT_NAME" -d "$WEB_DOMAIN"
fi
# 갱신하면 LiveKit이 새 인증서를 읽도록 다시 시작한다(운영과 같은 방식)
install -m 755 -d /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/restart-livekit.sh <<'SH'
#!/bin/sh
docker restart a301-prod-livekit >/dev/null 2>&1 || true
SH
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/restart-livekit.sh
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'SH'
#!/bin/sh
docker exec a301-prod-nginx nginx -s reload >/dev/null 2>&1 || true
SH
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

log "확인"
timedatectl show -p Timezone --value
swapon --show
docker --version
docker compose version
ls "/etc/letsencrypt/live/${TURN_DOMAIN}/" "/etc/letsencrypt/live/${WEB_CERT_NAME}/"
echo "OK: 셋팅 완료. docker 그룹을 적용하려면 SSH를 다시 연결한다"
