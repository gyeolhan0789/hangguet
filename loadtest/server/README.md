# 부하 테스트 서버 (EC2)

운영과 같은 사양 · 같은 이미지 · 같은 compose로 띄우는 부하 테스트 전용 서버다. 기준 문서는 [부하 테스트 계획](../../이해준/load_test_plan/README.md) 3.1 · 3.7이다.
운영 compose(`deploy/prod/compose.yml`)에 이 폴더의 덮어쓰기 파일만 더해 띄운다. 운영 서버 · 운영 설정은 건드리지 않는다.

## 파일

| 파일 | 내용 |
|---|---|
| `compose.loadtest.yml` | 운영 compose 덮어쓰기: 주소(`lt.` · `rtc-lt.` · `grafana-lt.`), 테스트 버킷, GMS 주소, 회사 카드 적재 끔, 테스트용 LiveKit 설정 |
| `livekit.yaml` | 운영 LiveKit 설정에서 TURN 도메인 · 인증서만 `turn-lt.hangguet.co.kr`로 바꾼 것 |
| `.env.example` | 서버에서 새로 만들 비밀값 이름. 서버에서 `.env`로 복사해 채운다(커밋하지 않는다) |
| `setup.sh` | 서버 기본 셋팅(시간대 · 스왑 · Docker · 로그 · TURN 인증서). 운영 서버와 같게 맞춘다 |
| `ssh.sh` | 로컬 PC(Git Bash)에서 서버 접속 · 명령 실행 · 파일 올리기. 키 경로는 `.env.ssh`(커밋하지 않는다)나 환경 변수로 준다 |
| `resources.sh` | 서버에서 실행. 컨테이너별 CPU(평균 · 최대) · 메모리(최대, 상한 대비)와 서버 전체 CPU · steal을 구간으로 요약한다. 예) `bash ~/a301/loadtest/server/resources.sh 5m` |
| `ssh.ps1` | PowerShell용. Git Bash로 `ssh.sh`를 부른다(PowerShell의 `bash`는 WSL bash일 수 있어 키 경로를 못 찾는다) |
| `aws/` | 테스트 버킷 정책 · CORS · 수명 주기, IAM 정책(앱 · 녹화). 운영(배포 계획 6.1 · 6.2)과 같은 모양이고 버킷 이름만 다르다 |

## 만들기

**첫 회차 24시간 전에 만든다.** T3 standard는 CPU 크레딧 0으로 시작해서, 만든 직후에는 CPU가 기준치(40%)를 넘지 못한다(계획 3.1.2).
예상 요금은 대략 $10~20이다(계획 3.1.1). 회차가 없는 날은 **중지**한다(크레딧은 7일간 남는다).

### 1. EC2 (AWS 콘솔, 서울 리전)

EC2 → 인스턴스 시작:

| 항목 | 값 |
|---|---|
| 이름 | `a301-loadtest` |
| AMI | Ubuntu Server 24.04 LTS, 64비트(x86) |
| 인스턴스 유형 | `t3.xlarge` |
| 키 페어 | 새로 만든다: `a301-loadtest`(.pem은 레포 밖에 둔다) |
| 보안 그룹 | 새로 만든다: `a301-loadtest`. 인바운드 아래 표 |
| 스토리지 | gp3 100GiB |
| 고급 세부 정보 → 크레딧 사양 | **Standard** (기본값 Unlimited를 바꾼다) |

| 인바운드 | 소스 | 용도 |
|---|---|---|
| TCP 22 | 내 IP | SSH |
| TCP 7881 | 0.0.0.0/0 | 미디어 예비 경로 |
| UDP 7882 | 0.0.0.0/0 | 미디어 |
| UDP 3478 | 0.0.0.0/0 | TURN/UDP |
| TCP 443 | 0.0.0.0/0 | TURN/TLS |

웹 · 시그널링 · Grafana는 Tunnel로만 받으므로 80 · 7880 · 3000은 열지 않는다(운영과 같음).

만든 뒤 **탄력적 IP**를 할당해 이 인스턴스에 연결한다. 크레딧 사양은 인스턴스 → 작업 → 인스턴스 설정 → 크레딧 사양 변경에서 `Standard`인지 다시 확인한다.

### 2. Cloudflare

1. Zero Trust → Networks → Tunnels → 터널 만들기(cloudflared): 이름 `a301-loadtest`. 설치 명령에 나오는 **토큰**만 복사해 둔다(`.env`의 `CLOUDFLARE_TUNNEL_TOKEN`)
2. 그 터널의 Public hostname

   | 호스트 이름 | 서비스 |
   |---|---|
   | `lt.hangguet.co.kr` | `http://a301-prod-nginx:80` |
   | `rtc-lt.hangguet.co.kr` | `http://a301-prod-livekit:7880` |
   | `grafana-lt.hangguet.co.kr` | `http://a301-prod-grafana:3000` |

3. DNS → 레코드 추가: `A` `turn-lt` → 탄력적 IP, **프록시 끔(회색 구름)**. TURN/TLS는 Cloudflare를 거칠 수 없다
4. 내 프로필 → API 토큰 → 토큰 만들기: 권한 `영역 · DNS · 편집`, 영역 `hangguet.co.kr`만. 이름 `a301-loadtest-dns`(`setup.sh`의 `CF_DNS_API_TOKEN`)
5. WAF · Bot Fight Mode 확인과 건너뛰기 규칙은 첫 회차 전에 한다(계획 3.3)

### 3. S3 · IAM (우리 AWS 계정)

1. S3 버킷 만들기: `hanggeut-a301-loadtest`, 서울. ACL 비활성화, 퍼블릭 액세스 모두 차단, 버전 관리 끔, SSE-S3
   - 권한 → 버킷 정책: `aws/bucket-policy.json`
   - 권한 → CORS: `aws/bucket-cors.json`
   - 관리 → 수명 주기 규칙: `aws/bucket-lifecycle.json`과 같게(완료되지 않은 멀티파트 업로드 7일 뒤 삭제)
2. IAM 사용자 둘(콘솔 접근 없음), 인라인 정책을 붙이고 액세스 키를 만든다

   | 사용자 | 정책 | `.env` |
   |---|---|---|
   | `a301-loadtest-app` | `aws/app-policy.json` | `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` |
   | `a301-loadtest-egress` | `aws/egress-policy.json` | `LIVEKIT_EGRESS_S3_ACCESS_KEY` · `LIVEKIT_EGRESS_S3_SECRET` |

버킷 이름을 바꾸면 `aws/*.json`과 `.env`의 `S3_BUCKET`도 같이 바꾼다.

### 4. Docker Hub

Account settings → Personal access tokens: 이름 `a301-loadtest-pull`, 권한 **Read-only**. 운영 pull 토큰은 쓰지 않는다.

### 5. 서버 셋팅

로컬 PC(Git Bash, 레포 루트)에서 접속 값을 정한다. 키 파일은 레포 밖에 둔다.

```bash
cat > loadtest/server/.env.ssh <<'EOF'
LOADTEST_HOST=<탄력적 IP>
LOADTEST_PEM=<a301-loadtest.pem 경로>
EOF
bash loadtest/server/ssh.sh 'hostname'   # 접속 확인
```

필요한 폴더만 레포와 같은 구조로 올린다(`compose.loadtest.yml`이 `../../loadtest/server/`를 가리킨다). 서버의 `.env`는 덮어쓰지 않는다. 파일을 고치면 다시 실행한다.

```bash
bash loadtest/server/ssh.sh upload
bash loadtest/server/ssh.sh              # 접속
```

PowerShell에서는 `.\loadtest\server\ssh.ps1`로 같은 인자를 넘긴다(`.\loadtest\server\ssh.ps1 upload`).

서버에서:

```bash
cd ~/a301/loadtest/server
CERTBOT_EMAIL=<메일> CF_DNS_API_TOKEN=<2-4의 토큰> sudo -E bash setup.sh
exit   # docker 그룹을 적용하려고 다시 접속한다
```

### 6. 띄우기

서버에서:

```bash
cd ~/a301
cp loadtest/server/.env.example loadtest/server/.env && chmod 600 loadtest/server/.env
vi loadtest/server/.env   # 값 채우기(.env.example 주석 참고)

COMPOSE="docker compose --env-file loadtest/server/.env -f deploy/prod/compose.yml -f loadtest/server/compose.loadtest.yml"

# Docker Hub 로그인은 받는 동안만 한다
read -rs DOCKERHUB_PULL_TOKEN && printf '%s' "$DOCKERHUB_PULL_TOKEN" | docker login -u hanggeut --password-stdin
$COMPOSE pull
docker logout && unset DOCKERHUB_PULL_TOKEN
$COMPOSE up -d
```

`IMAGE_TAG`는 **운영에 떠 있는 태그**를 쓴다. 운영 서버에서 `docker inspect a301-prod-be --format '{{.Config.Image}}'`로 보거나, GitLab Deployments → Environments → `prod/app`의 마지막 배포 커밋을 본다.

### 7. 확인

```bash
$COMPOSE ps                                             # 모두 running, healthcheck가 있는 것은 healthy
curl -s 127.0.0.1:18084/actuator/health                 # BE: "UP"
curl -s 127.0.0.1:18082/api/health                      # FE
curl -s 127.0.0.1:18083/health                          # AI
docker logs a301-prod-cloudflared 2>&1 | grep -m1 'Registered tunnel connection'
curl -s https://lt.hangguet.co.kr/api/health            # 바깥 주소 한 바퀴(로컬 PC에서)
sudo ss -tulpn | grep -E '0.0.0.0|\[::\]'               # 바깥에 열린 포트가 22 · 443 · 3478 · 7881 · 7882뿐인지
```

그다음 브라우저로 `https://lt.hangguet.co.kr`에서 가입 → 지원서 → 화상 면접 1건을 끝까지 하고, 결과와 다시보기(녹화 합치기)까지 되는지 본다(계획 7.2의 0단계).
Grafana는 `https://grafana-lt.hangguet.co.kr`(admin / `GRAFANA_ADMIN_PASSWORD`).

### 8. 크레딧 채우기

24시간 이상 켜 둔다. CloudWatch → 지표 → EC2 → 인스턴스별 → `CPUCreditBalance`가 최대(t3.xlarge 2,304)에 가까워졌는지 보고 첫 회차를 시작한다.

## 정리

모든 회차가 끝나면 계획 3.7 순서대로 지운다: 결과 내보내기(Grafana 화면 · EBS 스냅샷) → EC2 종료 · 탄력적 IP 해제 → 버킷 비우고 삭제 · IAM 사용자 삭제 → Tunnel · DNS(`lt` · `rtc-lt` · `grafana-lt` · `turn-lt`) · 건너뛰기 규칙 · DNS 토큰 삭제 → Docker Hub 테스트 토큰 삭제.
