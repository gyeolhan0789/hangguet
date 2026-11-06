#!/usr/bin/env bash
# 메인 서버(운영 · 테스트)를 Tailscale에 가입시킨다(이해준/agent_autoscale_plan 5.4). 서버(Ubuntu)에서 한 번 실행한다.
# 다시 실행해도 이미 된 단계는 건너뛴다.
#   sudo bash main-tailscale.sh loadtest   # 테스트 서버: tag:a301-loadtest-main
#   sudo bash main-tailscale.sh prod       # 운영 메인 서버: tag:a301-main
# 가입이 필요하면 OAuth 클라이언트 비밀값을 묻는다(화면에 보이지 않고 파일에 남기지 않는다).
#
# 1. Tailscale 설치(공식 스크립트) · tailscaled 켜기
# 2. 태그 기기로 가입: 1회용 아님(재부팅해도 남는다) · 미리 승인. 태그 기기는 키가 만료되지 않는다
#    --accept-dns=false: 서버의 DNS 설정을 바꾸지 않는다. ASG 인스턴스는 메인 서버를 이름이 아니라 Tailscale IP로 찾는다
# 3. net.ipv4.ip_nonlocal_bind=1: 재부팅 때 Docker가 Tailscale IP가 생기기 전에 떠도
#    compose가 그 IP에 연 포트(7880 · 6379 · 9090 · 3100, main-override.yml)를 묶을 수 있게 한다
# 4. Tailscale IP를 출력한다. compose .env의 MAIN_TAILSCALE_IP와 SSM livekit-url · redis-host에 쓴다
set -euo pipefail

A301_ENV="${1:-}"
case "$A301_ENV" in
  prod) TAG="tag:a301-main" ;;
  loadtest) TAG="tag:a301-loadtest-main" ;;
  *) echo "사용: sudo bash $0 prod|loadtest" >&2; exit 2 ;;
esac
[ "$(id -u)" -eq 0 ] || { echo "FAIL: sudo로 실행한다" >&2; exit 1; }

log() { echo "== $*"; }

log "Tailscale 설치"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled

log "가입 (${TAG})"
if tailscale ip -4 >/dev/null 2>&1; then
  echo "이미 가입되어 있다"
else
  read -rsp "Tailscale OAuth 클라이언트 비밀값: " TS_KEY
  echo
  tailscale up --auth-key="${TS_KEY}?ephemeral=false&preauthorized=true" \
    --advertise-tags="$TAG" --hostname="a301-${A301_ENV}-main" --accept-dns=false
  unset TS_KEY
fi

log "재부팅 때 포트 묶기"
echo 'net.ipv4.ip_nonlocal_bind=1' > /etc/sysctl.d/99-a301-tailscale.conf
sysctl -q -p /etc/sysctl.d/99-a301-tailscale.conf

log "확인"
tailscale status --peers=false
echo "MAIN_TAILSCALE_IP=$(tailscale ip -4)"
