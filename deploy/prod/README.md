# 운영 서버 배포 (Lightsail)

운영 서버에서 도는 서비스와 설정 파일이다. 기준 문서는 [운영 배포 계획](../../이해준/deploy_plan/README.md)이다.
개발 서버([`deploy/dev`](../dev))와 **같은 컨테이너 구성 · 같은 환경 변수 이름**으로 띄우고, 이미지 출처(Docker Hub)와 키 값만 다르다.

## 파일

| 파일 | 내용 |
|---|---|
| `compose.yml` | 운영 서비스 전체(프로젝트 `a301-prod`, 네트워크 `a301-prod`) |
| `livekit.yaml` | LiveKit 서버 설정(단일 UDP 포트, 내장 TURN, Redis). 키는 환경 변수 `LIVEKIT_KEYS` |
| `nginx.conf` | `/` → FE, `/be/` → BE, `/admin/` → 관리 페이지(개발 서버와 같은 경로 규칙). Swagger 경로는 404 |
| `prometheus.yml` · `blackbox.yml` | 지표 수집. 앱 job 이름은 개발 서버와 같고 서버 · 컨테이너 · LiveKit · Egress를 더 모은다 |
| `grafana/` | 데이터 소스 · 대시보드(개발 서버 대시보드를 그대로 복사, uid · 제목만 다름) |
| `backup.sh` | 매일 DB 백업(`pg_dump` → S3 `backup/`). 서버 cron이 `/opt/a301/backup.sh`를 실행한다 |

## 서비스

| 컨테이너 | 이미지 | 바깥 노출 |
|---|---|---|
| `a301-prod-be` · `-fe` · `-ai` · `-ai-agent` · `-admin` | `hanggeut/a301:{be,fe,ai,admin}-<IMAGE_TAG>` | 없음(헬스체크 포트만 루프백: BE 관리 18084, FE 18082, AI 18083) |
| `a301-prod-postgres` · `-redis` | 공식 이미지(개발 서버와 같은 버전) | 없음 |
| `a301-prod-nginx` · `-cloudflared` | 공식 이미지 | 없음(Tunnel이 밖으로 나가는 연결만 씀) |
| `a301-prod-livekit` · `-egress` | `livekit/livekit-server:v1.13.10` · `livekit/egress:v1.15.0` | LiveKit만 7881/tcp · 7882/udp · 3478/udp · 443/tcp |
| `a301-prod-prometheus` · `-blackbox` · `-node-exporter` · `-cadvisor` · `-grafana` | 공식 이미지 | 없음(Grafana는 Tunnel) |

Cloudflare Tunnel(`a301-prod`)의 호스트 이름은 컨테이너 이름을 가리킨다(Cloudflare 대시보드에서 설정, 배포 계획 5.1).
`hangguet.co.kr` → `http://a301-prod-nginx:80`, `rtc.hangguet.co.kr` → `http://a301-prod-livekit:7880`, `grafana.hangguet.co.kr` → `http://a301-prod-grafana:3000`

## 필요한 값

GitLab CI/CD Variables(배포 계획 7장). compose가 파일 전체를 읽으므로 어느 서비스를 띄우든 모두 필요하다.

- 범위 `prod/*`: `DB_PASSWORD`, `JWT_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_EGRESS_S3_ACCESS_KEY`, `LIVEKIT_EGRESS_S3_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFLARE_TUNNEL_TOKEN`
- 범위 All(개발과 같은 값): `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, `SONIOX_API_KEY`, `ELEVENLABS_API_KEY`(없으면 질문 글로만 진행)
- 배포 작업이 넣는 값: `IMAGE_TAG`(커밋 SHA, 필수). `DOCKERHUB_REPO`는 기본값 `hanggeut/a301`

## 배포 작업이 할 일 (CI `prod-deploy`)

Lightsail 러너(태그 `a301-prod`, shell)에서 레포 루트 기준으로 실행한다.

1. Docker Hub 로그인: 임시 폴더에서 pull 토큰으로(`DOCKER_CONFIG=$(mktemp -d)`, 배포 계획 8.1). 끝나면 로그아웃하고 지운다
2. 백업 준비: `deploy/prod/backup.sh`를 `/opt/a301/backup.sh`로 복사(실행 권한)하고, `/opt/a301/backup.env`(권한 600)에 `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` · `AWS_DEFAULT_REGION=ap-northeast-2`를 쓴다
3. `docker compose -f deploy/prod/compose.yml pull` → `up -d --remove-orphans`
4. 헬스체크: `http://127.0.0.1:18084/actuator/health`(BE), `http://127.0.0.1:18082/api/health`(FE), `http://127.0.0.1:18083/health`(AI), 나머지는 `docker inspect`의 health 상태(ai-agent · admin · nginx)
5. 이미지 정리: 접두사(`be-` · `fe-` · `ai-` · `admin-`)마다 최신 3개만 남긴다(배포 계획 8.2)

수동 실행(서버에서, 값을 환경 변수로 넣은 뒤):

```bash
IMAGE_TAG=<커밋 SHA> docker compose -f deploy/prod/compose.yml up -d
```

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

## 아직 없는 것

- **AI 분석 작업자**(`python -m app.worker`): 개발 서버에도 아직 띄우지 않았다. 개발에 추가할 때 같은 모양으로 여기에도 추가한다(이름 `a301-prod-ai-analysis`, 배포 계획 3.2)
- FE 지표(`A301_DEV_MONITORING`)는 개발 서버에서만 켠다. 그래서 대시보드의 FE 지표 패널은 운영에서 비어 있다
