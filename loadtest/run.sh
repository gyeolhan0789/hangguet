#!/usr/bin/env bash
# k6 실행. 레포 루트나 loadtest 폴더 어디서든 부른다(Git Bash · Linux · macOS).
#   bash loadtest/run.sh <loadtest 기준 스크립트 경로> [k6 run 옵션...]
#   예) N=1 bash loadtest/run.sh scenarios/s0-smoke.js
#
# - 값은 loadtest/.env.k6(커밋하지 않는다)와 환경 변수에서 받아 k6에 -e로 넘긴다(환경 변수가 우선)
# - k6가 설치돼 있으면 그것을, 없으면 Docker 이미지를 쓴다. 노트북마다 같은 버전을 쓰도록 고정한다(load_test_plan 3.2)
set -euo pipefail

K6_VERSION="2.3.0"
LOADTEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${1:?스크립트 경로가 필요하다(예: scenarios/s0-smoke.js)}"
shift

# k6에 넘길 값 이름
VARS=(BASE_URL LOADTEST_PASSWORD N COUNT START ACCOUNT_OFFSET PERSONA MODE PER_ACCOUNT ACCOUNTS RATES HOLD RAMP VUS MAX_VUS STAGGER START_AT WITH_APPLICATION ACCOUNTS_FILE LOGINS WARMUP REST WEB_RATE)

if [ -f "${LOADTEST_DIR}/.env.k6" ]; then
  while IFS='=' read -r key value; do
    case "$key" in ''|\#*) continue ;; esac
    # 이미 환경 변수로 준 값은 덮어쓰지 않는다
    [ -n "${!key:-}" ] || export "$key=$value"
  done < "${LOADTEST_DIR}/.env.k6"
fi

ENV_ARGS=()
for name in "${VARS[@]}"; do
  [ -n "${!name:-}" ] && ENV_ARGS+=(-e "${name}=${!name}")
done

# 브라우저 시나리오(파일 이름에 browser): Chromium에 가짜 카메라 · 마이크를 준다(load_test_plan 6장 S5)
BROWSER=false
case "$SCRIPT" in *browser*) BROWSER=true ;; esac
# WebGL은 끈다: GPU가 없는 Chromium은 면접관 3D 화면을 CPU로 그려 1개가 노트북 CPU를 약 9코어까지 쓴다(11/02 S5 동시 1건).
# 화면은 WebGL이 안 되면 정지 이미지로 대신하고 면접은 그대로 진행한다. 3D는 사용자 PC에서만 그리므로 서버 부하는 같다. BROWSER_3D=1이면 켠다
browser_args() {
  local media="$1"
  local args="no-sandbox,use-fake-ui-for-media-stream,use-fake-device-for-media-stream,use-file-for-fake-audio-capture=${media}/answer.wav,use-file-for-fake-video-capture=${media}/camera.y4m,autoplay-policy=no-user-gesture-required"
  [ "${BROWSER_3D:-0}" = "1" ] || args="${args},disable-3d-apis,disable-webgl"
  echo "$args"
}
if $BROWSER && [ ! -f "${LOADTEST_DIR}/media/answer.wav" ]; then
  echo "FAIL: media/answer.wav가 없다. media/make-media.ps1을 먼저 실행한다"; exit 1
fi
mkdir -p "${LOADTEST_DIR}/results"

cd "$LOADTEST_DIR"
if command -v k6 >/dev/null 2>&1; then
  $BROWSER && export K6_BROWSER_ARGS="$(browser_args "${LOADTEST_DIR}/media")"
  exec k6 run "${ENV_ARGS[@]}" "$@" "$SCRIPT"
fi

# Git Bash에서는 경로를 Windows 형식으로 바꿔 넘기고, 인자의 /경로가 바뀌지 않게 한다
MOUNT="$LOADTEST_DIR"
if command -v cygpath >/dev/null 2>&1; then
  MOUNT="$(cygpath -w "$LOADTEST_DIR")"
  export MSYS_NO_PATHCONV=1
fi
IMAGE="grafana/k6:${K6_VERSION}"
DOCKER_ARGS=()
if $BROWSER; then
  IMAGE="grafana/k6:${K6_VERSION}-with-browser"
  DOCKER_ARGS=(--shm-size=1g -e "K6_BROWSER_ARGS=$(browser_args /loadtest/media)")
fi
exec docker run --rm -i "${DOCKER_ARGS[@]}" -v "${MOUNT}:/loadtest" -w /loadtest "$IMAGE" \
  run "${ENV_ARGS[@]}" "$@" "$SCRIPT"
