#!/bin/bash
# 에이전트 인스턴스 시작 스크립트(이해준/agent_autoscale_plan 4 · 7장). 시작 템플릿의 user data에 이 파일 내용을 그대로 넣는다.
# AMI: Amazon Linux 2023(x86_64), 인스턴스 역할: a301-loadtest-agent(aws/agent-role-policy.json + AmazonSSMManagedInstanceCore)
#
# 하는 일
# 1. Docker 설치
# 2. SSM Parameter Store(/a301/loadtest/agent/*)에서 이미지 태그 · 접속 주소 · 비밀값을 읽는다. 비밀값은 시작 템플릿에 적지 않는다
# 3. Docker Hub에서 AI 이미지를 받고 바로 로그아웃한다(운영 이미지와 같은 태그)
# 4. 에이전트 컨테이너 하나를 띄운다(LiveKit에 a301-interviewer로 등록 → 면접을 배정받는다)
# 기록: /var/log/a301-agent-userdata.log. 접속은 SSH 대신 Systems Manager Session Manager로 한다
set -euo pipefail
exec > >(tee -a /var/log/a301-agent-userdata.log) 2>&1
echo "== $(date -Is) 에이전트 시작 스크립트"

REGION="ap-northeast-2"
PREFIX="/a301/loadtest/agent"
CONTAINER="a301-ai-agent"

param() {
  aws ssm get-parameter --region "$REGION" --name "$PREFIX/$1" --with-decryption --query Parameter.Value --output text
}

dnf install -y docker
systemctl enable --now docker

IMAGE="hanggeut/a301:ai-$(param image-tag)"
param dockerhub-token | docker login -u "$(param dockerhub-user)" --password-stdin
docker pull "$IMAGE"
docker logout

# 값을 먼저 변수로 읽는다. heredoc 안의 $(...)는 실패해도 set -e가 멈추지 않아, 빠진 매개변수를 놓친다
LIVEKIT_URL="$(param livekit-url)"
LIVEKIT_API_KEY="$(param livekit-api-key)"
LIVEKIT_API_SECRET="$(param livekit-api-secret)"
REDIS_HOST="$(param redis-host)"
SONIOX_API_KEY="$(param soniox-api-key)"
ELEVENLABS_API_KEY="$(param elevenlabs-api-key)"
JEV_API_KEY="$(param jev-api-key)"

# 비밀값은 root만 읽는 파일로 넘긴다(docker run 인자로 넘기면 ps · docker inspect 기록에 남는다)
ENV_FILE=/etc/a301-agent.env
install -m 600 /dev/null "$ENV_FILE"
cat > "$ENV_FILE" <<EOF
LIVEKIT_URL=${LIVEKIT_URL}
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
LIVEKIT_AGENT_NAME=a301-interviewer
REDIS_HOST=${REDIS_HOST}
REDIS_PORT=6379
SONIOX_API_KEY=${SONIOX_API_KEY}
SONIOX_STT_MODEL=stt-rt-v5
ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY}
JEV_API_KEY=${JEV_API_KEY}
EOF
unset LIVEKIT_API_SECRET SONIOX_API_KEY ELEVENLABS_API_KEY JEV_API_KEY

# - 메모리 3g: t3.medium(4GB)에서 OS · Docker 몫을 남긴다. 대당 약 9건이면 약 0.9GB를 쓴다(agent_autoscale_plan 4장)
# - --stop-timeout 1800: 줄일 때 SIGTERM을 받고 진행 중인 면접이 끝날 때까지 기다린다(drain, 6.3). 지금 단계(고정 대수)에서는 수동 시험에만 쓴다
# - 헬스체크는 운영 compose와 같다(에이전트 서버 8081). 지표 포트 9464는 다음 단계(CloudWatch 지표)에서 쓴다
docker rm -f "$CONTAINER" 2>/dev/null || true
docker run -d --name "$CONTAINER" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  --memory 3g \
  --stop-timeout 1800 \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  --health-cmd "python -c \"import urllib.request; r = urllib.request.urlopen('http://127.0.0.1:8081/', timeout=3); assert r.read() == b'OK'\"" \
  --health-interval 10s --health-timeout 5s --health-start-period 30s --health-retries 3 \
  "$IMAGE" python -m app.agent.main start

echo "== $(date -Is) 에이전트 컨테이너 시작: $IMAGE"
