#!/usr/bin/env bash
# 부하 테스트 서버 접속(README.md). 로컬 PC(Git Bash)에서 레포 루트 기준으로 실행한다.
#   bash loadtest/server/ssh.sh            # 접속
#   bash loadtest/server/ssh.sh <명령>     # 서버에서 명령 하나 실행(예: 'docker ps')
#   bash loadtest/server/ssh.sh upload     # deploy/prod · loadtest/server를 서버 ~/a301에 올린다(README.md 5단계, .env는 올리지 않는다)
#
# 값(환경 변수 또는 loadtest/server/.env.ssh, 커밋하지 않는다)
# - LOADTEST_HOST: 탄력적 IP
# - LOADTEST_PEM: 키 페어 파일 경로(레포 밖에 둔다)
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SERVER_DIR}/../.." && pwd)"
if [ -f "${SERVER_DIR}/.env.ssh" ]; then
  # shellcheck disable=SC1091
  . "${SERVER_DIR}/.env.ssh"
fi

LOADTEST_HOST="${LOADTEST_HOST:-15.164.167.125}"
LOADTEST_PEM="${LOADTEST_PEM:-$HOME/.ssh/a301-loadtest.pem}"
LOADTEST_USER="${LOADTEST_USER:-ubuntu}"

[ -f "$LOADTEST_PEM" ] || { echo "FAIL: 키 파일이 없다: ${LOADTEST_PEM} (LOADTEST_PEM으로 지정)"; exit 1; }

SSH_OPTS=(-i "$LOADTEST_PEM" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
TARGET="${LOADTEST_USER}@${LOADTEST_HOST}"

if [ "${1:-}" = "upload" ]; then
  # 레포와 같은 구조로 둔다(compose.loadtest.yml이 ../../loadtest/server/를 가리킨다). 서버의 .env는 덮어쓰지 않는다
  ssh "${SSH_OPTS[@]}" "$TARGET" 'mkdir -p ~/a301/deploy ~/a301/loadtest/server'
  scp "${SSH_OPTS[@]}" -r "${REPO_ROOT}/deploy/prod" "${TARGET}:~/a301/deploy/"
  ( cd "${SERVER_DIR}" && tar --exclude='.env' --exclude='.env.ssh' -cf - . ) \
    | ssh "${SSH_OPTS[@]}" "$TARGET" 'tar -xf - -C ~/a301/loadtest/server'
  echo "OK: ${TARGET}:~/a301에 올림"
  exit 0
fi

exec ssh "${SSH_OPTS[@]}" "$TARGET" "$@"
