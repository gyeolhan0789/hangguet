# ASG 인스턴스 시작 스크립트 본문(이해준/agent_autoscale_plan 4 · 5 · 7장). 혼자 실행하지 않는다.
# build.sh가 ROLE(agent · egress) · A301_ENV(prod · loadtest)와 watcher.sh · alloy.alloy를 앞에 붙여 user data 한 파일로 만든다.
#
# 1. Docker 설치
# 2. Tailscale 설치 · 가입(SSM tailscale-auth-key가 있을 때만. 없으면 같은 VPC 사설망으로 붙는 테스트 구성)
# 3. SSM /a301/<환경>/<역할>/*에서 주소 · 비밀값을 읽어 root만 읽는 파일로 컨테이너에 넘긴다(시작 템플릿에 비밀값을 적지 않는다)
# 4. 역할 컨테이너 실행: agent = a301-ai-agent(AI 이미지), egress = a301-egress(livekit/egress)
# 5. Alloy 실행(SSM metrics-url · loki-url이 둘 다 있을 때만): 지표 → 메인 Prometheus 원격 쓰기, 로그 → 메인 Loki
# 6. 감시 스크립트(a301-watcher) 실행
# 중간에 멈추면 인스턴스를 비정상(Unhealthy)으로 알려 ASG가 바꿔 띄운다(아래 report_boot_failure)
# 기록: /var/log/a301-userdata.log. 접속은 Session Manager
set -euo pipefail
exec > >(tee -a /var/log/a301-userdata.log) 2>&1
echo "== $(date -Is) a301 ${A301_ENV} ${ROLE} 시작"

REGION="ap-northeast-2"

# 부팅이 끝까지 가지 못하면(이미지 받기 실패 · SSM 값 없음 등) 인스턴스를 비정상으로 알려 ASG가 바꿔 띄우게 한다.
# 왜: 실패해도 EC2 상태 확인은 정상이라 ASG가 그대로 두고, 감시 스크립트도 뜨기 전이라 알릴 곳이 없다.
#     11/07 운영 전환에서 Docker Hub 토큰 권한이 모자라 이미지를 받지 못한 인스턴스가 InService로 남아 면접관이 약 16분 비었다.
# 시작 직후라 유예 기간을 지키지 않는다(지키면 ASG가 무시한다). 원인이 그대로면 바꿔 띄운 대도 같은 이유로 실패하고,
# 그 반복이 ASG 활동 기록에 남는다. 원인은 /var/log/a301-userdata.log(Session Manager)에서 본다
BOOT_OK=no
report_boot_failure() {
  local code=$?
  [ "$BOOT_OK" = yes ] && return
  echo "FAIL: $(date -Is) user data가 끝까지 가지 못했다(종료 코드 ${code}). 인스턴스를 비정상으로 알린다"
  local t id
  t=$(curl -sf -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60') || return
  id=$(curl -sf -H "X-aws-ec2-metadata-token: ${t}" http://169.254.169.254/latest/meta-data/instance-id) || return
  aws autoscaling set-instance-health --region "$REGION" --instance-id "$id" --health-status Unhealthy \
    --no-should-respect-grace-period ||
    echo "비정상 알리기 실패(ASG 밖에서 띄운 인스턴스이거나 권한 없음)"
}
trap report_boot_failure EXIT

PREFIX="/a301/${A301_ENV}/${ROLE}"
ALLOY_IMAGE="grafana/alloy:v1.20.1"
# 줄일 때 진행 중 면접 · 녹화를 기다리는 상한(초). 수명 주기 훅 제한 시간(3900초)과 같다. 그룹 면접 약 60분을 덮는다(계획 6.3)
DRAIN_SECONDS=3900

case "$ROLE" in
  agent)
    CONTAINER="a301-ai-agent"
    # 로그 라벨 service. 메인 서버 compose 서비스 이름과 같게 해 같은 로그 대시보드에서 본다
    SERVICE="a301-prod-ai-agent"
    HEALTH_URL="http://127.0.0.1:8081/"
    METRICS_URL="http://127.0.0.1:9464/metrics"
    METRIC_NAME="a301_agent_active_interviews"
    JOB="a301-ai-agent"
    ;;
  egress)
    CONTAINER="a301-egress"
    SERVICE="a301-prod-egress"
    HEALTH_URL="http://127.0.0.1:8080/"
    METRICS_URL="http://127.0.0.1:9090/metrics"
    METRIC_NAME="livekit_egress_requests"
    JOB="a301-egress"
    ;;
  *)
    echo "FAIL: 모르는 역할 ${ROLE}"
    exit 1
    ;;
esac

ssm_get() {
  aws ssm get-parameter --region "$REGION" --name "${PREFIX}/$1" --with-decryption \
    --query Parameter.Value --output text
}
# 콘솔에 붙여 넣다 들어간 앞뒤 공백 · CR은 떼고, 줄바꿈이 있으면 어느 값인지 알리고 멈춘다.
# 줄바꿈이 섞이면 뒤의 설정 파일 만들기(sed)가 알 수 없는 오류로 멈추고 감시 스크립트까지 뜨지 않는다(11/06 테스트)
clean() {
  local v=${2//$'\r'/}
  case "$v" in *$'\n'*) echo "FAIL: SSM ${PREFIX}/$1 값에 줄바꿈이 있다. 한 줄로 고친다" >&2; return 1 ;; esac
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}
param() { local v; v=$(ssm_get "$1") || return 1; clean "$1" "$v"; }
# 없어도 되는 값. 없으면 빈 문자열
param_opt() { local v; v=$(ssm_get "$1" 2>/dev/null) || return 0; clean "$1" "$v"; }

TOKEN=$(curl -sf -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
md() { curl -sf -H "X-aws-ec2-metadata-token: ${TOKEN}" "http://169.254.169.254/latest/meta-data/$1"; }
INSTANCE_ID=$(md instance-id)
AZ=$(md placement/availability-zone)

dnf install -y docker
systemctl enable --now docker

TS_KEY=$(param_opt tailscale-auth-key)
if [ -n "$TS_KEY" ]; then
  curl -fsSL https://tailscale.com/install.sh | sh
  systemctl enable --now tailscaled
  # OAuth 클라이언트 비밀값으로 1회용(꺼지면 tailnet에서 빠짐) · 미리 승인 · 역할 태그로 가입한다(계획 5.4)
  # 테스트 환경은 태그를 따로 둔다(tag:a301-loadtest-agent). ACL에서 테스트 인스턴스가 운영 메인 서버에 닿지 않게 한다
  if [ "$A301_ENV" = prod ]; then TS_TAG="tag:a301-${ROLE}"; else TS_TAG="tag:a301-${A301_ENV}-${ROLE}"; fi
  tailscale up --auth-key="${TS_KEY}?ephemeral=true&preauthorized=true" \
    --advertise-tags="$TS_TAG" --hostname="a301-${A301_ENV}-${ROLE}-${INSTANCE_ID}"
  TAILSCALE=yes
else
  TAILSCALE=no
fi
unset TS_KEY

# 값을 먼저 변수로 읽는다. heredoc · printf 안의 $(...)는 실패해도 set -e가 멈추지 않는다
LIVEKIT_URL=$(param livekit-url)
LIVEKIT_API_KEY=$(param livekit-api-key)
LIVEKIT_API_SECRET=$(param livekit-api-secret)
REDIS_HOST=$(param redis-host)
REDIS_PASSWORD=$(param_opt redis-password)
METRICS_WRITE_URL=$(param_opt metrics-url)
LOKI_URL=$(param_opt loki-url)
LIVEKIT_HOSTPORT=${LIVEKIT_URL#*://}
LIVEKIT_HOSTPORT=${LIVEKIT_HOSTPORT%%/*}
LIVEKIT_HOST=${LIVEKIT_HOSTPORT%:*}
LIVEKIT_PORT=${LIVEKIT_HOSTPORT##*:}

install -d -m 700 /etc/a301
install_files

ENV_FILE="/etc/a301/${ROLE}.env"
install -m 600 /dev/null "$ENV_FILE"
put() { [ -z "$2" ] || printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"; }

run_agent() {
  local image
  image="hanggeut/a301:ai-$(param image-tag)"
  # Docker Hub 로그인 정보를 디스크에 남기지 않는다(배포 계획 8.1과 같은 방식)
  DOCKER_CONFIG=$(mktemp -d)
  export DOCKER_CONFIG
  param dockerhub-token | docker login -u "$(param dockerhub-user)" --password-stdin
  docker pull "$image"
  docker logout
  rm -rf "$DOCKER_CONFIG"
  unset DOCKER_CONFIG

  local soniox elevenlabs jev llm_url llm_model llm_key idle stt_model
  soniox=$(param soniox-api-key)
  elevenlabs=$(param_opt elevenlabs-api-key)
  jev=$(param_opt jev-api-key)
  llm_url=$(param_opt llm-chat-url)
  llm_model=$(param_opt llm-model)
  llm_key=$(param_opt llm-api-key)
  idle=$(param_opt idle-processes)
  stt_model=$(param_opt soniox-stt-model)
  put LIVEKIT_URL "$LIVEKIT_URL"
  put LIVEKIT_API_KEY "$LIVEKIT_API_KEY"
  put LIVEKIT_API_SECRET "$LIVEKIT_API_SECRET"
  put LIVEKIT_AGENT_NAME a301-interviewer
  put REDIS_HOST "$REDIS_HOST"
  put REDIS_PORT 6379
  put REDIS_PASSWORD "$REDIS_PASSWORD"
  put SONIOX_API_KEY "$soniox"
  put SONIOX_STT_MODEL "${stt_model:-stt-rt-v5}"
  put ELEVENLABS_API_KEY "$elevenlabs"
  put JEV_API_KEY "$jev"
  # 꼬리질문(GMS). 빠지면 오류 없이 미리 만든 질문으로 진행하므로 첫 면접 로그로 확인한다(계획 7장)
  put LLM_CHAT_URL "$llm_url"
  put LLM_MODEL "$llm_model"
  put LLM_API_KEY "$llm_key"
  put AGENT_IDLE_PROCESSES "$idle"

  # - 메모리 1536m: t3.small(2GB)에서 OS · Docker · Tailscale · Alloy 몫(약 0.5GB)을 남긴다(계획 4.1)
  # - 8081(상태) · 9464(지표)는 루프백에만 연다. 감시 스크립트와 Alloy(host 네트워크)가 읽는다
  docker run -d --name "$CONTAINER" \
    --restart unless-stopped \
    --env-file "$ENV_FILE" \
    --memory 1536m \
    --stop-timeout "$DRAIN_SECONDS" \
    -p 127.0.0.1:8081:8081 -p 127.0.0.1:9464:9464 \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    --health-cmd "python -c \"import urllib.request; r = urllib.request.urlopen('http://127.0.0.1:8081/', timeout=3); assert r.read() == b'OK'\"" \
    --health-interval 10s --health-timeout 5s --health-start-period 30s --health-retries 3 \
    "$image" python -m app.agent.main start
  echo "== $(date -Is) 에이전트 시작: ${image}"
}

run_egress() {
  local image
  image=$(param egress-image)
  docker pull "$image"

  # 설정 본문은 한 줄 JSON(YAML로도 읽힌다)으로 env 파일에 넣는다. 여러 줄 YAML은 env 파일에 넣을 수 없다
  # - S3 키는 넣지 않는다. BE가 녹화 요청에 담아 보낸다(배포 계획 4.3)
  # - track_cpu_cost 0.05: 2코어 한 대가 15초 안에 받는 녹화를 늘린다(계획 2.3 [제안], 9장에서 확정)
  # - max_memory 3: 컨테이너 상한(3g)이 차기 전에 새 녹화를 거절한다(계획 4.2)
  local redis_json body
  redis_json="\"address\":\"${REDIS_HOST}:6379\""
  [ -z "$REDIS_PASSWORD" ] || redis_json="${redis_json},\"password\":\"${REDIS_PASSWORD}\""
  body="{\"log_level\":\"info\",\"api_key\":\"${LIVEKIT_API_KEY}\",\"api_secret\":\"${LIVEKIT_API_SECRET}\""
  body="${body},\"ws_url\":\"${LIVEKIT_URL}\",\"redis\":{${redis_json}},\"health_port\":8080,\"prometheus_port\":9090"
  body="${body},\"cpu_cost\":{\"track_cpu_cost\":0.05,\"max_memory\":3}}"
  put EGRESS_CONFIG_BODY "$body"
  unset body redis_json

  # - --stop-signal SIGTERM: Egress는 SIGTERM이면 진행 중 녹화를 마치고 종료하고, SIGINT면 바로 멈춘다(계획 6.5)
  # - 8080(상태) · 9090(지표)는 루프백에만 연다
  docker run -d --name "$CONTAINER" \
    --restart unless-stopped \
    --env-file "$ENV_FILE" \
    --memory 3g \
    --stop-signal SIGTERM \
    --stop-timeout "$DRAIN_SECONDS" \
    -p 127.0.0.1:8080:8080 -p 127.0.0.1:9090:9090 \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    "$image"
  echo "== $(date -Is) Egress 시작: ${image}"
}

"run_${ROLE}"
unset LIVEKIT_API_SECRET

# sed 치환 값에서 구분자(|) · & · \를 이스케이프한다
esc() { printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'; }

# 지표 · 로그 보내기. 실패해도 지표 · 로그만 빠지므로 감시 스크립트는 계속 띄운다
start_alloy() {
  local metrics_target=${METRICS_URL#http://}
  metrics_target=${metrics_target%%/*}
  sed -e "s|@@JOB@@|$(esc "$JOB")|g" -e "s|@@METRICS_TARGET@@|$(esc "$metrics_target")|g" \
    -e "s|@@METRICS_WRITE_URL@@|$(esc "$METRICS_WRITE_URL")|g" -e "s|@@LOKI_URL@@|$(esc "$LOKI_URL")|g" \
    -e "s|@@CONTAINER@@|$(esc "$CONTAINER")|g" -e "s|@@SERVICE@@|$(esc "$SERVICE")|g" -e "s|@@ENV@@|$(esc "$A301_ENV")|g" -e "s|@@ROLE@@|$(esc "$ROLE")|g" \
    -e "s|@@INSTANCE_ID@@|$(esc "$INSTANCE_ID")|g" -e "s|@@AZ@@|$(esc "$AZ")|g" \
    /etc/a301/alloy.alloy.tmpl >/etc/a301/alloy.alloy || return 1
  docker run -d --name a301-alloy \
    --restart unless-stopped \
    --network host \
    --memory 192m \
    -v /etc/a301/alloy.alloy:/etc/alloy/config.alloy:ro \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v a301-alloy-data:/var/lib/alloy/data \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    "$ALLOY_IMAGE" run --storage.path=/var/lib/alloy/data --disable-reporting /etc/alloy/config.alloy || return 1
}

if [ -n "$METRICS_WRITE_URL" ] && [ -n "$LOKI_URL" ]; then
  if start_alloy; then
    echo "== $(date -Is) Alloy 시작"
  else
    echo "WARN: Alloy를 띄우지 못했다(지표 · 로그만 빠진다). 감시 스크립트는 계속 띄운다"
  fi
fi

install -m 600 /dev/null /etc/a301/redis-password
printf '%s' "$REDIS_PASSWORD" >/etc/a301/redis-password
cat >/etc/a301/watcher.env <<EOF
ROLE=${ROLE}
CONTAINER=${CONTAINER}
REGION=${REGION}
INSTANCE_ID=${INSTANCE_ID}
HOOK_NAME=a301-${A301_ENV}-${ROLE}-drain
DRAIN_SECONDS=${DRAIN_SECONDS}
HEALTH_URL=${HEALTH_URL}
METRICS_URL=${METRICS_URL}
METRIC_NAME=${METRIC_NAME}
TAILSCALE=${TAILSCALE}
LIVEKIT_HOST=${LIVEKIT_HOST}
LIVEKIT_PORT=${LIVEKIT_PORT}
REDIS_HOST=${REDIS_HOST}
REDIS_PORT=6379
EOF
chmod 600 /etc/a301/watcher.env
unset REDIS_PASSWORD

cat >/etc/systemd/system/a301-watcher.service <<'EOF'
[Unit]
Description=A301 ASG 인스턴스 감시(축소 보호 · 수명 주기 훅 · 준비 확인)
After=docker.service network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/a301-watcher
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now a301-watcher
BOOT_OK=yes
echo "== $(date -Is) 감시 시작. 끝"
