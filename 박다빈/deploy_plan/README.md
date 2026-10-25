# 회사 카드 파이프라인 CD 인계 계획

작성: 박다빈 (2026-10-26) · 대상: 이 작업을 맡아 줄 팀원

## 0. 한 줄 요약

`company-pipeline/`이 바뀐 MR이 **develop에 병합되면 EC2에 자동 배포**되게 한다.
팀 개발 서버(미니PC)와 같은 방식: **배포할 서버(EC2) 안에 GitLab 러너**를 두고, 러너가 그 서버에서 `docker compose up -d`를 실행한다.
이미지 빌드·Docker Hub는 쓰지 않는다(공식 이미지 Airflow·Postgres·MinIO + 코드 폴더 연결).

```
company-pipeline/ 변경 MR → develop 병합
→ GitLab: pipeline-deploy 잡 생성 (태그 a301-pipeline-deploy)
→ EC2 러너가 가져감 → 코드를 /opt/a301-pipeline 으로 복사(데이터 폴더 유지)
→ docker compose up -d → Airflow 헬스 체크 → 성공/실패
```

## 1. 지금 상태

| 항목 | 상태 |
|---|---|
| 폴더 분리 | 끝남. MR !132 병합(10-23). 파이프라인은 `company-pipeline/`, MVP AI는 `ai/` |
| CI | 끝남. `.gitlab-ci.yml`의 `pipeline-test`(company-pipeline 변경 MR에서 ruff·mypy·pytest) |
| EC2 | 인스턴스만 있음(빈 Ubuntu). 서울 리전, t3.medium(2코어·4GB), 디스크 30GB, 탄력적 IP `13.209.132.209`, 보안 그룹은 SSH(22)만 |
| CD | **안 함 (이 문서의 작업)** |
| 메모리 검증 | 로컬에서 4GB 조건으로 111곳 실행 통과(아래 5장 함정 1 수정 후). 실제 EC2 측정은 아직 |

## 2. 준비물과 누가 하나

| 준비물 | 누가 | 비고 |
|---|---|---|
| Jira 이슈·브랜치 | 작업자 | 예: `S15P31A301-<번호>/ai/feature/pipeline-cd` |
| **러너 토큰** | **Maintainer(이해준)** | Settings → CI/CD → Runners → New project runner. 태그 `a301-pipeline-deploy`, Run untagged jobs 해제, **Protected** 체크. 토큰(`glrt-...`)은 DM으로만 |
| EC2 접속 키(pem) | 박다빈 | 작업자가 직접 접속해야 하면 박다빈이 SSH 공개키를 서버에 추가해 주는 방식 권장(pem 파일 전달 대신) |
| **API 키 `.env`** | **박다빈이 직접 서버에 올림** | DART·네이버·GMS 키. 메신저·채팅·git으로 주고받지 않는다. CI/CD Variables도 쓰지 않는다(Maintainer 권한 필요하고 노출 지점이 늘어남) |
| 기존 카드 111개 | 박다빈이 서버로 1회 복사 | 안 옮기면 첫 실행 때 111곳 카드를 새로 만들어 GMS 크레딧이 크게 든다 |

## 3. 순서

### 3.1 EC2 기본 셋팅 (1회)

```bash
ssh -i <pem> ubuntu@13.209.132.209

# 스왑 2GB (메모리가 잠깐 튀어도 프로세스가 죽지 않게)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 시간대 (13:00 일정·로그를 한국 시간으로)
sudo timedatectl set-timezone Asia/Seoul

# Docker (공식 스크립트)
curl -fsSL https://get.docker.com | sudo sh
```

### 3.2 러너 설치·등록 (1회)

```bash
# GitLab Runner (공식 저장소)
curl -L "https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh" | sudo bash
sudo apt-get install -y gitlab-runner
sudo usermod -aG docker gitlab-runner            # 러너가 docker 명령을 쓰게

# 배포 폴더 (러너 계정 전용)
sudo mkdir -p /opt/a301-pipeline && sudo chown gitlab-runner:gitlab-runner /opt/a301-pipeline

# 등록: 토큰은 Maintainer에게 받은 값을 이 자리에 직접 입력
sudo gitlab-runner register --non-interactive \
  --url https://lab.ssafy.com --token <glrt-토큰> \
  --executor shell --description a301-pipeline-ec2
```

GitLab Settings → CI/CD → Runners에서 초록불 확인.

### 3.3 키·데이터 올리기 (박다빈, 1회)

```bash
# 노트북에서
scp -i <pem> company-pipeline/.env ubuntu@13.209.132.209:/tmp/pipeline.env
# 서버에서
sudo mv /tmp/pipeline.env /opt/a301-pipeline/.env
sudo chown gitlab-runner:gitlab-runner /opt/a301-pipeline/.env && sudo chmod 600 /opt/a301-pipeline/.env
```

카드 111개는 첫 배포가 끝난 뒤 `/opt/a301-pipeline/pipeline/data/cards/`에 복사(소유자 50000, 5장 함정 2).

### 3.4 코드 수정 (MR 하나)

**① `company-pipeline/airflow/docker-compose.yaml`**

- `x-airflow-common.environment`에 추가 (**필수**, 5장 함정 1):
  ```yaml
  # 실행 프로세스를 동시 실행 수만큼 미리 띄운다(하나에 약 150MB). 기본 32개면 약 1GB라 4GB 서버에서
  # 메모리 부족으로 작업이 죽는다. llm 풀이 1이라 실제로 동시에 도는 작업은 1~2개뿐
  AIRFLOW__CORE__PARALLELISM: "4"
  ```
  (박다빈 로컬에 `git stash`로 보관 중: "S15P31A301 CD용: Airflow 동시 실행 4개")
- 서비스마다 로그 크기 제한(팀 `deploy/dev/compose.yml`과 같게):
  ```yaml
  logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }
  ```
- 포트는 지금처럼 `127.0.0.1`에만 연다(8080 Airflow, 9000·9001 MinIO). 바깥에 열지 않는다

**② `.gitlab-ci.yml`에 잡 추가** (기존 잡은 건드리지 않는다)

```yaml
## 회사 카드 파이프라인 배포 (EC2) ##
# - develop에 company-pipeline/ 변경이 병합되면 EC2 러너(태그 a301-pipeline-deploy, Protected, shell)가 배포한다.
# - 이미지를 빌드하지 않는다. 공식 이미지 + 코드 폴더를 /opt/a301-pipeline 으로 복사해 compose로 띄운다.
# - API 키(.env)와 수집 데이터(pipeline/data)는 서버에만 있고 복사할 때 지우지 않는다.
# - 롤백: Deployments > Environments > pipeline 에서 이전 배포 Re-deploy.
pipeline-deploy:
  stage: deploy
  tags:
    - "a301-pipeline-deploy"
  interruptible: false
  resource_group: pipeline-deploy
  needs: []
  rules:
    - if: '$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "develop"'
      changes:
        - company-pipeline/**/*
  environment:
    name: pipeline
  variables:
    DEPLOY_DIR: "/opt/a301-pipeline"
  script:
    - test -f "$DEPLOY_DIR/.env" || { echo "FAIL: $DEPLOY_DIR/.env 가 없습니다 (3.3)"; exit 1; }
    # 코드만 덮어쓴다. .env·pipeline/data·airflow/logs 는 서버 것을 유지
    - rsync -a --delete --exclude .env --exclude pipeline/data/ --exclude airflow/logs/
      company-pipeline/pipeline company-pipeline/airflow "$DEPLOY_DIR/"
    - mkdir -p "$DEPLOY_DIR/pipeline/data" "$DEPLOY_DIR/airflow/logs"
    # 컨테이너 안 Airflow는 uid 50000으로 쓴다(5장 함정 2)
    - docker run --rm -v "$DEPLOY_DIR:/d" alpine:3.22 chown -R 50000:0 /d/pipeline/data /d/airflow/logs
    - cd "$DEPLOY_DIR/airflow" && docker compose up -d --remove-orphans
    - |
      for i in $(seq 1 60); do
        curl -fsS http://127.0.0.1:8080/api/v2/monitor/health 2>/dev/null | grep -q '"healthy"' && { echo "OK: 배포 완료"; exit 0; }
        sleep 5
      done
      echo "FAIL: Airflow 헬스 체크 실패"; docker compose logs --tail 100; exit 1
```

확인할 것: 서버에 `rsync`가 없으면 `sudo apt-get install -y rsync`. 헬스 응답 형식은 Airflow 3.3 기준으로 첫 배포 때 한 번 확인.

**③ `company-pipeline/airflow/README.md`**에 "EC2 배포·롤백" 절 추가(위 흐름, 키 위치, 롤백 방법).

### 3.5 첫 배포와 검증

1. MR → `pipeline-test` 통과 → develop 병합 → `pipeline-deploy` 성공 확인
2. 서버에서 `docker compose ps` 5개 정상, `airflow dags list`에 DAG 2개
3. 카드 111개 복사(3.3) 후 **▶ `company_news_daily` 한 번 실행**하며 측정
   ```bash
   free -m; sudo docker stats --no-stream
   ```
   - 기준(로컬 4GB 조건 결과): scheduler 최대 약 735MB, 5개 합계 약 1.6GB, 111곳 약 25분, 실패 0
   - 메모리 부족(OOM) 로그나 실패가 나오면 멈추고 박다빈에게 공유
4. 통과하면 `company_news_daily` 일시정지 해제(매일 13:00 자동 실행)
   - `company_cards_full`(카드 전체 생성)은 GMS 크레딧이 크게 드니 필요할 때만 수동 실행

## 4. 하지 않는 것

- Airflow(8080)·MinIO(9000·9001)를 인터넷에 열기. Airflow가 "모두 관리자"(`SIMPLE_AUTH_MANAGER_ALL_ADMINS`) 설정이라 열면 누구나 작업 실행·설정 변경 가능. 화면은 SSH 터널로만:
  `ssh -i <pem> -L 8080:127.0.0.1:8080 ubuntu@13.209.132.209` → 브라우저 `http://localhost:8080`
- API 키를 git·채팅·메신저·CI 로그에 남기기
- Lightsail(MVP)과 연결: MVP 이후. 그때 보안 그룹에 Lightsail 고정 IP 하나만 추가

## 5. 함정 (이미 겪은 것)

1. **메모리 부족**: Airflow LocalExecutor가 기본 32개 작업 프로세스를 미리 띄워 약 1GB를 차지한다. 4GB 조건에서 111곳 중 88곳이 OOM(SIGKILL -9)으로 죽었다 → `AIRFLOW__CORE__PARALLELISM: "4"`로 해결(scheduler 1GB → 236MB)
2. **폴더 권한**: 컨테이너 안 Airflow는 uid 50000. 서버 폴더 소유자가 다르면 로그·카드를 못 쓴다 → `pipeline/data`, `airflow/logs`를 `50000:0`으로
3. **DAG는 처음에 일시정지**(`DAGS_ARE_PAUSED_AT_CREATION`). 배포 후 직접 해제해야 13:00에 돈다
4. **SSAFY 계정 제약**: 콘솔에서 시드니 등 다른 리전은 막혀 있다(SCP). 서울만 사용
5. **첫 실행 비용**: 서버에 카드가 없으면 매일 작업이 111곳 카드를 새로 만든다 → 카드 먼저 복사

## 6. 롤백

- GitLab → Deployments → Environments → `pipeline` → 이전 배포 **Re-deploy** (그 커밋 코드로 다시 복사·실행)
- 급하면 서버에서 `cd /opt/a301-pipeline/airflow && sudo docker compose down` (데이터 볼륨은 남는다. `-v`는 붙이지 않는다)

## 7. 참고

- 파이프라인 사용법: `company-pipeline/pipeline/README.md`
- 로컬 Airflow: `company-pipeline/airflow/README.md`
- 팀 배포 방식: `.gitlab-ci.yml`의 `.dev-deploy`·`mock-deploy`, `이해준/deploy_plan/README.md` 8장
