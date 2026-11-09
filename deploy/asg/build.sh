#!/usr/bin/env bash
# 시작 템플릿에 붙여 넣을 user data 한 파일을 만든다(이해준/agent_autoscale_plan 7장).
#   bash deploy/asg/build.sh agent prod > user-data-agent.sh      # 운영 에이전트(a301-prod-agent)
#   bash deploy/asg/build.sh egress prod > user-data-egress.sh    # 운영 Egress(a301-prod-egress-node)
#   bash deploy/asg/build.sh agent loadtest > user-data.sh        # 테스트 환경(SSM /a301/loadtest/agent/*)
# bootstrap.sh 앞에 역할 · 환경 값과, 인스턴스에 깔 파일(watcher.sh · alloy.alloy)을 그대로 붙인다.
# 붙인 파일은 주석 · 빈 줄을 빼고 넣는다. user data는 16KB가 상한이라 넘으면 실패한다.
set -euo pipefail

ROLE="${1:-}"
A301_ENV="${2:-}"
case "$ROLE" in agent | egress) ;; *) echo "사용: $0 agent|egress prod|loadtest" >&2; exit 2 ;; esac
case "$A301_ENV" in prod | loadtest) ;; *) echo "사용: $0 agent|egress prod|loadtest" >&2; exit 2 ;; esac

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIMIT=16384

# 줄 맨 앞의 주석과 빈 줄을 뺀다(첫 줄 #! 포함). 문자열 안의 #은 줄 맨 앞이 아니므로 남는다
strip() { grep -v -E '^[[:space:]]*(#|//|$)' "$1"; }

out="$(
  echo '#!/bin/bash'
  echo "# A301 ${A301_ENV} ${ROLE} user data. deploy/asg/build.sh로 만든다(직접 고치지 않는다). 커밋 $(git -C "$DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "ROLE=${ROLE}"
  echo "A301_ENV=${A301_ENV}"
  echo 'install_files() {'
  echo "cat >/usr/local/bin/a301-watcher <<'A301_WATCHER_EOF'"
  echo '#!/bin/bash'
  strip "$DIR/watcher.sh"
  echo 'A301_WATCHER_EOF'
  echo 'chmod 755 /usr/local/bin/a301-watcher'
  echo "cat >/etc/a301/alloy.alloy.tmpl <<'A301_ALLOY_EOF'"
  strip "$DIR/alloy.alloy"
  echo 'A301_ALLOY_EOF'
  echo '}'
  strip "$DIR/bootstrap.sh"
)"

size=$(printf '%s\n' "$out" | wc -c)
if [ "$size" -gt "$LIMIT" ]; then
  echo "FAIL: user data ${size}바이트가 상한 ${LIMIT}바이트를 넘는다" >&2
  exit 1
fi
printf '%s\n' "$out"
echo "user data ${size}/${LIMIT}바이트" >&2
