#!/usr/bin/env bash
# 운영 배포(prod-deploy) 뒤 에이전트 ASG를 같은 버전으로 맞춘다(이해준/agent_autoscale_plan 7.1).
# .gitlab-ci.yml prod-deploy가 deploy/prod/deploy.sh 성공 뒤에 부른다. 메인 서버 러너(SSAFY 계정)에서 돈다.
#
# 1. SSM /a301/prod/agent/image-tag = IMAGE_TAG(이번 배포의 커밋 짧은 SHA)
# 2. a301-prod-agent ASG 인스턴스 새로 고침 시작: 새 대를 먼저 띄우고(최소 정상 100% · 최대 200%),
#    옛 대는 수명 주기 훅 → 감시 스크립트 → drain으로 진행 중 면접을 마친 뒤 내린다(계획 6.3)
#    면접 중이라 축소 보호가 켜진 대는 보호가 풀릴 때까지 기다린다(ScaleInProtectedInstances=Wait)
# 끝날 때까지 기다리지 않는다(진행 중 면접 때문에 최대 30분). 진행은 콘솔 · `describe-instance-refreshes`로 본다.
# 되돌리기: GitLab에서 이전 배포를 Re-deploy하면 이 스크립트도 이전 SHA로 다시 돈다.
#
# 필요한 CI/CD 변수(범위 prod/*, Protected · Masked)
# - AGENT_ASG_ENABLED: "true"일 때만 돈다. 없거나 다르면 아무것도 하지 않고 끝난다(메인 서버 안 에이전트 구성)
# - AGENT_REFRESH_AWS_ACCESS_KEY_ID · AGENT_REFRESH_AWS_SECRET_ACCESS_KEY: 우리 계정 IAM 사용자 a301-prod-agent-ci의 키.
#   권한은 iam/ci-agent-refresh-policy.json(이 매개변수 쓰기 · 이 ASG 새로 고침뿐)
# AWS CLI는 러너에 설치하지 않고 공식 이미지로 돌린다.
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG(커밋 짧은 SHA)가 필요하다}"

if [ "${AGENT_ASG_ENABLED:-}" != "true" ]; then
  echo "SKIP: AGENT_ASG_ENABLED가 true가 아니어서 에이전트 ASG를 건드리지 않는다(에이전트는 메인 서버 compose로 배포됨)"
  exit 0
fi

: "${AGENT_REFRESH_AWS_ACCESS_KEY_ID:?AGENT_REFRESH_AWS_ACCESS_KEY_ID CI/CD 변수가 필요하다}"
: "${AGENT_REFRESH_AWS_SECRET_ACCESS_KEY:?AGENT_REFRESH_AWS_SECRET_ACCESS_KEY CI/CD 변수가 필요하다}"

REGION="ap-northeast-2"
ASG="a301-prod-agent"
PARAM="/a301/prod/agent/image-tag"
AWS_CLI_IMAGE="amazon/aws-cli:2.27.0"

# 키는 명령줄에 쓰지 않고 환경 변수로 넘긴다(러너의 프로세스 목록에 보이지 않게)
export AWS_ACCESS_KEY_ID="$AGENT_REFRESH_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$AGENT_REFRESH_AWS_SECRET_ACCESS_KEY"
aws() {
  docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_PAGER= \
    "$AWS_CLI_IMAGE" --region "$REGION" "$@"
}

# 이미 진행 중인 새로 고침이 있으면 새로 시작할 수 없다. 태그도 바꾸지 않고 멈춘다(섞인 상태를 만들지 않게)
status=$(aws autoscaling describe-instance-refreshes --auto-scaling-group-name "$ASG" --max-records 1 \
  --query 'InstanceRefreshes[0].Status' --output text)
case "$status" in
  Pending | InProgress | Cancelling | RollbackInProgress | Baking)
    echo "FAIL: ${ASG}에 진행 중인 인스턴스 새로 고침이 있다(${status}). 끝난 뒤 이 잡을 다시 돌린다(메인 서버 배포는 이미 끝났다)"
    exit 1
    ;;
esac

aws ssm put-parameter --name "$PARAM" --value "$IMAGE_TAG" --overwrite >/dev/null
echo "OK: ${PARAM} = ${IMAGE_TAG}"

refresh_id=$(aws autoscaling start-instance-refresh --auto-scaling-group-name "$ASG" \
  --preferences '{"MinHealthyPercentage":100,"MaxHealthyPercentage":200,"InstanceWarmup":180,"ScaleInProtectedInstances":"Wait","StandbyInstances":"Ignore"}' \
  --query InstanceRefreshId --output text)
echo "OK: ${ASG} 인스턴스 새로 고침 시작(${refresh_id}). 새 대가 뜬 뒤 옛 대는 진행 중 면접을 마치고 내려간다"
