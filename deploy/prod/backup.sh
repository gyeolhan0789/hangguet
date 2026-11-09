#!/bin/sh
# 운영 DB 백업(배포 계획 9장). 매일 pg_dump → S3 backup/
# 서버에서 러너 계정(gitlab-runner)의 cron으로 돈다:
#   30 4 * * * /opt/a301/backup.sh >> /opt/a301/backup/backup.log 2>&1
# 이 파일은 배포 작업(prod-deploy)이 /opt/a301/backup.sh로 복사한다.
#
# S3 키는 배포 작업이 GitLab 변수로 /opt/a301/backup.env(권한 600)에 써 둔다. 키 원본은 GitLab에만 둔다.
#   AWS_ACCESS_KEY_ID=…  AWS_SECRET_ACCESS_KEY=…  AWS_DEFAULT_REGION=ap-northeast-2 (IAM a301-prod-app, backup/ 쓰기)
#
# 복원: pg_restore로 되살린다(custom 형식). 예)
#   docker exec -i a301-prod-postgres pg_restore -U a301 -d a301 --clean --if-exists < a301-YYYYMMDD-HHMMSS.dump
set -eu
# 덤프에는 회원 정보가 들어 있으므로 러너 계정만 읽게 만든다(권한 600). 업로드하는 aws-cli 컨테이너는 root라 그대로 읽는다
umask 077

ENV_FILE=/opt/a301/backup.env
BACKUP_DIR=/opt/a301/backup
CONTAINER=a301-prod-postgres
BUCKET=hanggeut-a301-prod
AWS_CLI_IMAGE=amazon/aws-cli:2.38.5
# 서버에는 최근 며칠만 남긴다. S3 보관 기간은 아직 정하지 않았다(배포 계획 13장).
KEEP_LOCAL_DAYS=7

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*"
}

# 첫 배포 전처럼 DB가 없으면 할 일이 없다
if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -qx true; then
    log "SKIP: ${CONTAINER} 컨테이너가 실행 중이 아니다"
    exit 0
fi

if [ ! -r "$ENV_FILE" ]; then
    log "FAIL: ${ENV_FILE}이 없다. 배포 작업이 S3 키를 써 두었는지 확인한다"
    exit 1
fi

NAME="a301-$(date '+%Y%m%d-%H%M%S').dump"
FILE="${BACKUP_DIR}/${NAME}"
# 중간에 실패하면 덜 쓴 파일을 남기지 않는다
trap 'rm -f "$FILE"' EXIT

docker exec "$CONTAINER" pg_dump -U a301 -d a301 --format=custom > "$FILE"
trap - EXIT
log "OK: 덤프 ${NAME} ($(du -h "$FILE" | cut -f1))"

# 업로드가 실패해도 서버의 덤프는 남겨 둔다(다음 날 다시 올리지는 않으므로 로그를 보고 직접 올린다)
docker run --rm --env-file "$ENV_FILE" -v "${BACKUP_DIR}:/backup:ro" "$AWS_CLI_IMAGE" \
    s3 cp --only-show-errors "/backup/${NAME}" "s3://${BUCKET}/backup/${NAME}"
log "OK: s3://${BUCKET}/backup/${NAME} 업로드"

find "$BACKUP_DIR" -name 'a301-*.dump' -mtime +"$KEEP_LOCAL_DAYS" -delete
