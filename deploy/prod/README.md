# 운영 서버 배포 (Lightsail)

운영 서버에서 도는 서비스와 설정 파일이다. 기준 문서는 [운영 배포 계획](../../이해준/deploy_plan/README.md)이다.
개발 서버([`deploy/dev`](../dev))와 **같은 컨테이너 구성 · 같은 환경 변수 이름**으로 띄우고, 이미지 출처(Docker Hub)와 키 값만 다르다.

## 파일

| 파일 | 내용 |
|---|---|
| `compose.yml` | 운영 서비스 전체(프로젝트 `a301-prod`, 네트워크 `a301-prod`) |
| `livekit.yaml` | LiveKit 서버 설정(단일 UDP 포트, 내장 TURN, Redis). 키는 환경 변수 `LIVEKIT_KEYS` |
| `nginx.conf` | `/` → FE, `/be/` → BE, `/admin/` → 관리 페이지(개발 서버와 같은 경로 규칙). Swagger 경로는 404 |
| `prometheus.yml` · `blackbox.yml` | 지표 수집. 앱 job 이름은 개발 서버와 같고 서버 · 컨테이너 · LiveKit · Egress · Redis · PostgreSQL을 더 모은다 |
| `loki.yml` · `alloy.alloy` | 로그 수집(Alloy가 `a301-prod-*` 컨테이너 로그를 Loki에 7일 보관). 개발 서버와 같고 보관 기간 · 이름만 다르다 |
| `grafana/` | 데이터 소스(Prometheus · Loki) · 대시보드 **A301 운영 서버**(지표) · **A301 운영 서버 로그**(아래 「대시보드」) |
| `backup.sh` | 매일 DB 백업(`pg_dump` → S3 `backup/`). 서버 cron이 `/opt/a301/backup.sh`를 실행한다 |
| `deploy.sh` | 운영 배포 스크립트. CI `prod-deploy`가 실행한다(아래 「배포」) |

## 서비스

| 컨테이너 | 이미지 | 바깥 노출 |
|---|---|---|
| `a301-prod-be` · `-fe` · `-ai` · `-ai-agent` · `-ai-analysis` · `-ai-plan` · `-ai-recording` · `-admin` | `hanggeut/a301:{be,fe,ai,admin}-<IMAGE_TAG>`(AI 다섯 컨테이너는 같은 `ai-` 이미지, 명령 · 환경 변수만 다름) | 없음(헬스체크 포트만 루프백: BE 관리 18084, FE 18082, AI 18083) |
| `a301-prod-postgres` · `-redis` | 공식 이미지(개발 서버와 같은 버전) | 없음 |
| `a301-prod-nginx` · `-cloudflared` | 공식 이미지 | 없음(Tunnel이 밖으로 나가는 연결만 씀) |
| `a301-prod-livekit` · `-egress` | `livekit/livekit-server:v1.13.10` · `livekit/egress:v1.15.0` | LiveKit만 7881/tcp · 7882/udp · 3478/udp · 443/tcp |
| `a301-prod-prometheus` · `-blackbox` · `-node-exporter` · `-cadvisor` · `-grafana` | 공식 이미지 | 없음(Grafana는 Tunnel) |
| `a301-prod-redis-exporter` · `-postgres-exporter` | `oliver006/redis_exporter:v1.93.0` · `quay.io/prometheuscommunity/postgres-exporter:v0.20.1` | 없음 |
| `a301-prod-loki` · `-alloy` | `grafana/loki:3.7.8` · `grafana/alloy:v1.20.1`(개발 서버와 같음) | 없음 |

Cloudflare Tunnel(`a301-prod`)의 호스트 이름은 컨테이너 이름을 가리킨다(Cloudflare 대시보드에서 설정, 배포 계획 5.1).
`hangguet.co.kr` → `http://a301-prod-nginx:80`, `rtc.hangguet.co.kr` → `http://a301-prod-livekit:7880`, `grafana.hangguet.co.kr` → `http://a301-prod-grafana:3000`

## 필요한 값

GitLab CI/CD Variables(배포 계획 7장). compose가 파일 전체를 읽으므로 어느 서비스를 띄우든 모두 필요하다.

- 범위 `prod/*`: `DB_PASSWORD`, `JWT_SECRET`, `INQUIRY_ENCRYPTION_KEY`(Base64 32바이트, 잃으면 문의를 풀 수 없으므로 따로 보관), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_EGRESS_S3_ACCESS_KEY`, `LIVEKIT_EGRESS_S3_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFLARE_TUNNEL_TOKEN`
- 범위 All(개발과 같은 값): `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, `SONIOX_API_KEY`, `LLM_API_KEY`, `ELEVENLABS_API_KEY`(없으면 질문 글로만 진행), `JEV_API_KEY`(없으면 리액션 없이 진행)
- GMS 주소 · 모델(`LLM_CHAT_URL` · `LLM_MODEL`)은 비밀이 아니라 compose에 적었다(개발과 같은 값)
- 배포 작업이 넣는 값: `IMAGE_TAG`(커밋 짧은 SHA, 필수), `DOCKERHUB_PULL_TOKEN`(범위 `prod/*`). 빌드 잡은 `DOCKERHUB_PUSH_TOKEN`

## 배포 (CI, `.gitlab-ci.yml`의 「운영 서버」)

```
develop → Release MR → master 병합
  → prod-build (자동, yobi 미니PC 배포 러너): be · fe · ai · admin 이미지 빌드 → Docker Hub push → 미니PC에서 지움
  → prod-deploy (▶ 버튼, Lightsail 러너 a301-prod): deploy.sh
```

- 배포 시점을 사람이 고른다(배포 계획 8.1 [결정]). 배포하면 에이전트 · LiveKit이 다시 떠 진행 중인 면접이 끊길 수 있다
- 롤백: GitLab Deployments > Environments > `prod/app`에서 이전 배포를 Re-deploy 한다. 그 커밋의 이미지로 다시 띄운다(서버에 최근 3개, Docker Hub에 전부 있음)

`deploy.sh`가 하는 일:

1. Docker Hub 로그인: 임시 폴더에서 pull 토큰으로 하고, 끝나면 성공 · 실패와 관계없이 로그아웃하고 지운다
2. 배포 파일 복사: `deploy/prod/` → `/opt/a301/prod/`(compose를 여기서 실행해 설정 파일 경로가 체크아웃 위치와 관계없이 같다). 설정 파일(`livekit.yaml` · `nginx.conf` · `prometheus.yml` · `blackbox.yml` · `loki.yml` · `alloy.alloy` · `grafana/`)이 바뀐 서비스는 기억해 둔다
3. 백업 준비: `backup.sh`를 `/opt/a301/backup.sh`로 복사하고, `/opt/a301/backup.env`(권한 600)에 S3 키를 쓴다
4. `pull` → `up -d --remove-orphans`. 설정 파일만 바뀐 서비스는 다시 시작한다(파일 하나를 붙인 컨테이너는 compose가 다시 만들지 않으므로). 바뀌지 않았으면 LiveKit을 다시 시작하지 않는다
5. 확인(실패하면 해당 서비스 로그를 남기고 잡을 실패시킨다)
   - 모든 서비스가 실행 중이고, healthcheck가 있는 서비스는 healthy(180초)
   - BE `127.0.0.1:18084/actuator/health` · FE `127.0.0.1:18082/api/health` · AI `127.0.0.1:18083/health`가 `UP`
   - Cloudflare Tunnel 연결(`Registered tunnel connection`)
   - 바깥 주소 `https://hangguet.co.kr/api/health`가 `UP`(Cloudflare → Tunnel → Nginx → FE 한 바퀴)
6. 이미지 정리: 접두사(`be-` · `fe-` · `ai-` · `admin-`)마다 최신 3개만 남긴다(배포 계획 8.2)

서버에서 직접 돌릴 때(비밀값을 환경 변수로 넣은 뒤, 레포 루트에서): `IMAGE_TAG=<커밋 짧은 SHA> bash deploy/prod/deploy.sh`

## 대시보드

https://grafana.hangguet.co.kr → A301. 팀원은 Viewer 계정으로 본다(배포 계획 3.3). 대시보드는 `grafana/dashboards/` 파일에서 자동 등록되고 화면에서는 고칠 수 없다. 파일을 고쳐 배포하면 Grafana가 다시 시작되며 반영된다.

**A301 운영 서버**(지표, 30초마다 새로 고침). 위에서부터 줄(row) 단위로 본다.

| 줄 | 보는 것 | 출처(job) |
|---|---|---|
| 전체 현황 | FE · BE · AI 상태, 서버 CPU · 메모리 · 디스크 %, Redis 메모리 %, 면접방 · 참가자 · 녹화 수, DB 연결 %, 메모리 초과 종료 수, 지표 수집 실패 수. 70% 노랑 · 85% 빨강 | 여러 곳 |
| 서버 | CPU(용도별) · load average · 메모리 · 디스크 남은 용량 · 디스크 읽기/쓰기 · 서버 네트워크 | `a301-node`, 네트워크만 `a301-cadvisor` |
| BE · AI | 개발 서버와 같은 패널(요청 · 5xx · 응답 시간 · DB 풀 · JVM · AI 큐 · AI 실패) | `a301-be` · `a301-health` |
| LiveKit · 녹화 | 면접방 · 참가자 · 녹화 수, 패킷 손실률, RTT · 지터 p95, 입장 실패 · 녹화 결과 | `a301-livekit` · `a301-egress` |
| Redis | 메모리(상한 192MB 대비) · 연결 · 명령/초 · 키 수 · 오류(OOM) | `a301-redis` |
| PostgreSQL | 연결 수(상태별) · 트랜잭션/초 · DB 크기 · 캐시 적중률 · 가장 오래 열린 트랜잭션 · 잠금 · 교착 | `a301-postgres` |
| FE | 첫 화면 응답 시간 · 실패(서버 쪽 검사) | `a301-fe-page` |
| 컨테이너 | 컨테이너별 CPU · 메모리 · 메모리 상한(`mem_limit`) 대비 · 네트워크 · 가동 시간 · 재시작/메모리 초과 종료 | `a301-cadvisor` |

- 서버 네트워크는 cAdvisor의 호스트 값(`id="/"`, Docker 브리지 · veth 제외)으로 본다. node-exporter는 컨테이너 네트워크 안에 있어 자기 네트워크만 보이기 때문이다
- 면접이 없으면 LiveKit 패킷 · 지연 패널은 「면접 트래픽 없음」으로 비어 있다
- 컨테이너 재시작은 같은 컨테이너가 다시 뜬 횟수다. 배포로 새로 만든 컨테이너는 「가동 시간」이 짧아지는 것으로 본다
- postgres-exporter는 앱과 같은 DB 계정(`a301`, `DB_PASSWORD`)으로 통계 뷰만 읽는다

**A301 운영 서버 로그**(Loki, 7일 보관). 사용법은 개발 서버와 같고([`deploy/dev/monitoring/README.md`](../dev/monitoring/README.md) 「로그 보기」) 아래가 더 있다.

- 위의 **수준**에서 전체 · 오류 · 경고 이상을 고른다(아래 「로그」 패널에 적용)
- 흐름별 오류 · 경고: BE(예외 스택 포함), 면접 진행(AI 에이전트), 분석 작업, 미디어 · 녹화(LiveKit · Egress), Nginx 5xx 응답, 기동 · 재시작 로그

로그에 개인정보(이메일 · 자소서 · 답변 원문 · 토큰)를 남기지 않는 것이 조건이다.

## 서버에 미리 해 둔 것

배포 계획 3.1 · 4.2 · 5.2 · 11장. 2026-10-26에 다시 확인했다.

- Docker 29.9 · Compose v5.6, 스왑 4GB, 시간대 `Asia/Seoul`, 로그 10MB × 3
- ufw: 22 · 7881/tcp · 7882/udp · 3478/udp · 443/tcp
- TURN 인증서 `/etc/letsencrypt/live/turn.hangguet.co.kr/`(자동 갱신, 갱신 뒤 `a301-prod-livekit` 재시작). LiveKit 이미지는 root로 돌아 그대로 읽는다
- 러너 `a301-prod`(protected, shell), 러너 계정은 docker 그룹. 배포 폴더 `/opt/a301`(러너 계정 전용), 백업 폴더 `/opt/a301/backup`
- 백업 cron(러너 계정): `30 4 * * * /opt/a301/backup.sh >> /opt/a301/backup/backup.log 2>&1`. DB 컨테이너가 없으면 건너뛴다
- 공개 이미지(LiveKit · Egress · Nginx · cloudflared · 모니터링 · aws-cli)를 미리 받아 두었다

## 개발 서버와 다른 설정

키 값과 이미지 출처 말고 개발 서버와 다르게 둔 것은 아래뿐이다. 늘릴 때는 배포 계획에 이유를 남긴다.

- Swagger를 공개하지 않는다: BE `SPRINGDOC_API_DOCS_ENABLED=false` · `SPRINGDOC_SWAGGER_UI_ENABLED=false`, Nginx에서 `/be/docs` · `/be/swagger-ui` · `/be/v3/api-docs` 404(배포 계획 3.2)
- FE 지표(`A301_DEV_MONITORING`)를 켜지 않는다(아래)
- BE 메모리 상한 1280m(개발 768m), JVM 옵션에 `-XX:+ExitOnOutOfMemoryError`를 더한다. 힙을 다 쓰면 약 1.06GB를 써 768m로는 강제 종료될 수 있어서다(배포 계획 3.2)

## 아직 없는 것

- FE 지표(`A301_DEV_MONITORING`)는 개발 서버에서만 켠다. 그래서 운영 대시보드에는 브라우저 오류 · Web Vitals 패널이 없다
- 알림(디스크 · 메모리 임계치)은 배포 계획 3.3에서 [미정]이다. 지금은 대시보드 색으로만 본다
