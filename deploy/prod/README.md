# 운영 서버 배포 (Lightsail)

운영 서버에서 도는 서비스와 설정 파일이다. 기준 문서는 [운영 배포 계획](../../이해준/deploy_plan/README.md)이다.
개발 서버([`deploy/dev`](../dev))와 **같은 컨테이너 구성 · 같은 환경 변수 이름**으로 띄우고, 이미지 출처(Docker Hub)와 키 값만 다르다.

## 파일

| 파일 | 내용 |
|---|---|
| `compose.yml` | 운영 서비스 전체(프로젝트 `a301-prod`, 네트워크 `a301-prod`) |
| `livekit.yaml` | LiveKit 서버 설정(단일 UDP 포트, 내장 TURN, Redis). 키는 환경 변수 `LIVEKIT_KEYS` |
| `nginx.conf` | Nginx 전체 설정(`/etc/nginx/nginx.conf`). 443을 도메인 이름(SNI)으로 나눠 웹 3개는 직접 HTTPS로 받고 그 밖(`turn.`)은 LiveKit TURN/TLS로 넘긴다. 80은 https로 보낸다. 앱은 `/` → FE, `/be/` → BE, `/admin/` → 관리 페이지(개발 서버와 같은 경로 규칙), Swagger 경로는 404 |
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
| `a301-prod-nginx` | 공식 이미지 | 443/tcp(웹 + TURN/TLS, SNI로 나눔) · 80/tcp(→ 컨테이너 8080, https로 보냄) |
| `a301-prod-cloudflared` | 공식 이미지 | 없음(Tunnel이 밖으로 나가는 연결만 씀). DNS를 서버 IP로 바꾸는 동안만 둔다 |
| `a301-prod-livekit` · `-egress` | `livekit/livekit-server:v1.13.10` · `livekit/egress:v1.15.0` | LiveKit만 7881/tcp · 7882/udp · 3478/udp. TURN/TLS(컨테이너 443)는 Nginx를 거친다 |
| `a301-prod-prometheus` · `-blackbox` · `-node-exporter` · `-cadvisor` · `-grafana` | 공식 이미지 | 없음(Grafana는 Nginx `grafana.hangguet.co.kr`) |
| `a301-prod-redis-exporter` · `-postgres-exporter` | `oliver006/redis_exporter:v1.93.0` · `quay.io/prometheuscommunity/postgres-exporter:v0.20.1` | 없음 |
| `a301-prod-loki` · `-alloy` | `grafana/loki:3.7.8` · `grafana/alloy:v1.20.1`(개발 서버와 같음) | 없음 |

바깥 요청은 서버 443 → `a301-prod-nginx`가 도메인 이름으로 나눈다(배포 계획 5.1). Cloudflare는 DNS만 쓴다(프록시 끔).

| 도메인 | Nginx가 넘기는 곳 |
|---|---|
| `hangguet.co.kr` | 앱(FE · BE · 관리 페이지) |
| `rtc.hangguet.co.kr` | `http://a301-prod-livekit:7880`(WebSocket) |
| `grafana.hangguet.co.kr` | `http://a301-prod-grafana:3000` |
| 그 밖(`turn.hangguet.co.kr`) | `a301-prod-livekit:443`(TLS를 풀지 않고 그대로, TURN/TLS) |

전환 기간에는 Cloudflare Tunnel(`a301-prod`)도 남아 있다. 호스트 이름은 `hangguet.co.kr` → `http://a301-prod-nginx:80`, `rtc.` → `http://a301-prod-livekit:7880`, `grafana.` → `http://a301-prod-grafana:3000`이다(Cloudflare 대시보드). DNS를 서버 IP로 바꾼 뒤 cloudflared · 컨테이너 80 입구와 함께 지운다.

## 필요한 값

GitLab CI/CD Variables(배포 계획 7장). compose가 파일 전체를 읽으므로 어느 서비스를 띄우든 모두 필요하다.

- 범위 `prod/*`: `DB_PASSWORD`, `JWT_SECRET`, `INQUIRY_ENCRYPTION_KEY`(Base64 32바이트, 잃으면 문의를 풀 수 없으므로 따로 보관), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_EGRESS_S3_ACCESS_KEY`, `LIVEKIT_EGRESS_S3_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFLARE_TUNNEL_TOKEN`
- 범위 All(개발과 같은 값): `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, `SONIOX_API_KEY`, `LLM_API_KEY`, `ELEVENLABS_API_KEY`(없으면 질문 글로만 진행), `JEV_API_KEY`(없으면 리액션 없이 진행), `KAKAO_CLIENT_ID` · `KAKAO_CLIENT_SECRET` · `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET`(없으면 그 소셜 로그인만 503, `KAKAO_CLIENT_ID`는 FE에도 넘긴다)
- 범위 `prod/*`, 선택(개발과 다른 값): `AGENT_IDLE_PROCESSES`(AI 에이전트가 미리 실행해 두는 프로세스 수, 0 이상의 정수. 없으면 CPU 수라 지금 서버는 4. 개발은 같은 이름을 범위 `dev/*`로 따로 등록한다)
- GMS 주소 · 모델(`LLM_CHAT_URL` · `LLM_MODEL`)은 비밀이 아니라 compose에 적었다(개발과 같은 값)
- 배포 작업이 넣는 값: `IMAGE_TAG`(커밋 짧은 SHA, 필수), `DOCKERHUB_PULL_TOKEN`(범위 `prod/*`). 빌드 잡은 `DOCKERHUB_PUSH_TOKEN`
- `deploy.sh`가 계산해 넣는 값: `A301_{NGINX,LIVEKIT,PROMETHEUS,BLACKBOX,LOKI,ALLOY,GRAFANA}_CONFIG_HASH`(필수, 아래 「배포」 1번). GitLab 변수에 두지 않는다

## 배포 (CI, `.gitlab-ci.yml`의 「운영 서버」)

```
develop → Release MR → master 병합
  → prod-build (자동, yobi 미니PC 배포 러너): be · fe · ai · admin 이미지 빌드 → Docker Hub push → 미니PC에서 지움
  → prod-deploy (▶ 버튼, Lightsail 러너 a301-prod): deploy.sh
```

- 배포 시점을 사람이 고른다(배포 계획 8.1 [결정]). 배포하면 에이전트 · LiveKit이 다시 떠 진행 중인 면접이 끊길 수 있다
- 롤백: GitLab Deployments > Environments > `prod/app`에서 이전 배포를 Re-deploy 한다. 그 커밋의 이미지 · `deploy/prod/` 설정 · `deploy.sh`로 다시 띄운다(이미지는 서버에 최근 3개, Docker Hub에 전부 있음). DB 스키마(Flyway)는 되돌아가지 않으므로, 그 사이에 마이그레이션이 있었으면 예전 BE가 뜨는지 먼저 확인한다
  - master 수동 실행(Run pipeline)으로 `IMAGE_TAG`를 넘기는 방법은 쓸 수 없다. `workflow.rules`가 수동 실행을 develop에서만 만든다
  - S15P31A301-391(설정 해시 · 순서 · 확인 보강) 이전 커밋으로 롤백하면 그 커밋의 예전 `deploy.sh`가 돈다. 예전 스크립트의 터널 확인(`docker logs | grep -q`)은 cloudflared가 오래 떠 있으면 SIGPIPE로 실패해, 컨테이너는 바뀌었는데 잡만 실패로 끝날 수 있다(아래 「배포」 6번). 이때는 서버에서 `docker ps --filter name=a301-prod`(compose 명령은 비밀값이 필요하다)로 이미지 태그 · 상태를 보고, 바깥 주소 3개로 직접 확인한다. 라벨이 사라져 7개 서비스가 다시 만들어지는 것도 같다(아래 「설정 파일 반영」)

`deploy.sh`가 하는 일:

1. 설정 해시: 설정 파일(`nginx.conf` · `livekit.yaml` · `prometheus.yml` · `blackbox.yml` · `loki.yml` · `alloy.alloy` · `grafana/`)마다 내용 해시를 `A301_*_CONFIG_HASH`로 넘긴다. compose가 이 값을 그 서비스의 라벨 `a301.config-hash`로 붙인다
2. Docker Hub 로그인: 임시 폴더에서 pull 토큰으로 하고, 끝나면 성공 · 실패와 관계없이 로그아웃하고 지운다
3. 설정 검사 · 이미지 받기: 체크아웃의 `deploy/prod/compose.yml`로 `config --quiet` → `pull`. 서버의 배포 파일은 아직 바꾸지 않으므로, 여기서 실패하면 설정 파일 · 컨테이너가 모두 예전 그대로 남는다(먼저 복사해 두면 예전 컨테이너가 재시작될 때 새 설정 파일을 읽어 예전 이미지와 섞인다)
4. 백업 준비: `backup.sh`를 `/opt/a301/backup.sh`로 복사하고, `/opt/a301/backup.env`(권한 600)에 S3 키를 쓴다
5. 배포 파일 복사 → `up -d --remove-orphans`: `deploy/prod/` → `/opt/a301/prod/`(compose를 여기서 실행해 설정 파일 경로가 체크아웃 위치와 관계없이 같다). 이미지 · 환경 변수 · 설정 해시가 바뀐 서비스만 compose가 다시 만든다. 설정이 그대로면 LiveKit을 다시 띄우지 않는다
6. 확인(실패하면 해당 서비스 로그를 남기고 잡을 실패시킨다)
   - 모든 서비스가 실행 중이고, healthcheck가 있는 서비스는 healthy(180초)
   - BE `127.0.0.1:18084/actuator/health` · FE `127.0.0.1:18082/api/health` · AI `127.0.0.1:18083/health`가 `UP`
   - 바깥 주소 3개(도메인 전부, 각 120초). DNS가 가리키는 길로 간다. Tunnel을 가리키는 동안은 터널 연결도 이것으로 본다. 실패하면 cloudflared와 그 경로 서비스의 로그를 남긴다
     - `https://hangguet.co.kr/api/health`가 `UP`(Nginx → FE)
     - `https://rtc.hangguet.co.kr/`가 `OK`(면접방 시그널링, LiveKit)
     - `https://grafana.hangguet.co.kr/api/health`가 `"database": "ok"`(대시보드)
   - 직접 접속(각 60초): 서버 안에서 `127.0.0.1`의 443 · 80으로 붙되 도메인 이름은 진짜로 보낸다(`curl --resolve`). DNS가 어디를 가리키든 서버로 바로 오는 길이 살아 있는지 본다
     - 위 3개 주소가 같은 응답
     - 443에 `turn.hangguet.co.kr`로 붙으면 LiveKit이 TURN 인증서로 답한다(SNI 분기)
     - `http://hangguet.co.kr/`가 `301 https://hangguet.co.kr/`
   - cloudflared 로그의 `Registered tunnel connection`은 기준으로 쓰지 않는다. cloudflared를 다시 만들지 않은 배포에서는 예전 기동 때 줄이라 지금 연결을 뜻하지 않고, 로그가 회전되면 연결이 멀쩡해도 사라진다. 또 `pipefail`에서 `docker logs | grep -q`는 로그가 길면(약 64KB 이상) 줄을 찾고도 `docker logs`가 SIGPIPE로 죽어 실패로 판정된다. 10/29 무렵 배포가 터널이 멀쩡한데 이것으로 실패했다(배포 계획 14장)
   - 재시작 반복: 위 healthy 확인 때 적어 둔 컨테이너별 재시작 수가 20초 뒤(HTTP 확인 시간 포함)에도 그대로이고 모두 실행 중이어야 한다. healthcheck가 없는 서비스(LiveKit · Egress · Prometheus · Loki · Alloy · Grafana · cloudflared · exporter)는 설정이 틀려 뜨자마자 죽어도 restart로 다시 떠, 실행 중인 순간만 보면 통과하기 때문이다(개발 모니터링 잡과 같은 확인)
7. 이미지 정리: 접두사(`be-` · `fe-` · `ai-` · `admin-`)마다 최신 3개만 남긴다(배포 계획 8.2)

서버에서 직접 돌릴 때(비밀값을 환경 변수로 넣은 뒤, 레포 루트에서): `IMAGE_TAG=<커밋 짧은 SHA> bash deploy/prod/deploy.sh`. 설정 해시가 필수라 `docker compose`를 직접 치지 않는다

### 설정 파일 반영(설정 해시)

설정 파일만 바뀌면 compose 설정은 그대로라 `up -d`가 컨테이너를 그대로 두고, 프로세스는 기동할 때 읽은 예전 설정을 계속 쓴다. 그래서 파일 내용 해시를 라벨로 붙여, 해시가 바뀐 서비스만 `up -d`가 다시 만들게 한다(개발 서버 [`deploy/dev/monitoring`](../dev/monitoring/README.md)과 같은 방식).

- 비교 기준이 실행 중인 컨테이너의 라벨이라, 배포가 중간에 실패해도 다음 배포에서 맞춰진다. 이미지 버전과 설정을 함께 바꿔도 한 번만 다시 만든다
- 다시 만들어도 데이터는 볼륨(`prometheus-data` · `loki-data` · `alloy-data` · `grafana-data`)에 있어 남는다. 이전 컨테이너의 `docker logs`는 사라지므로 Loki에서 본다
- 해시에는 `deploy/prod/` 기준 파일 경로도 들어간다. 계산 방식(`deploy.sh`의 `config_hash`)이나 파일 이름을 바꾸면 내용이 같아도 그 서비스가 다시 만들어진다
- **라벨이 처음 붙는 배포**(이 방식으로 바꾼 뒤 첫 배포)와 **이 방식 이전 커밋으로 롤백하는 배포**는 라벨이 생기거나 사라져 7개 서비스(LiveKit · Nginx 포함)가 한 번 다시 만들어진다. 진행 중인 면접이 끊기므로 대시보드에서 면접방이 0인지 보고 누른다
- LiveKit에 기대는 Egress, Loki · Prometheus에 기대는 Alloy · Grafana는 함께 다시 시작될 수 있다

## 대시보드

https://grafana.hangguet.co.kr → A301. 팀원은 Viewer 계정으로 본다(배포 계획 3.3). 대시보드는 `grafana/dashboards/` 파일에서 자동 등록되고 화면에서는 고칠 수 없다. 파일을 고쳐 배포하면 설정 해시가 바뀌어 Grafana가 다시 만들어지며 반영된다.

**A301 운영 서버**(지표, 30초마다 새로 고침). 위에서부터 줄(row) 단위로 본다.

| 줄 | 보는 것 | 출처(job) |
|---|---|---|
| 전체 현황 | FE · BE · AI 상태, 서버 CPU · 메모리 · 디스크 %, Redis 메모리 %, 면접방 · 참가자 · 녹화 수, DB 연결 %, 메모리 초과 종료 수, 지표 수집 실패 수. 70% 노랑 · 85% 빨강 | 여러 곳 |
| 서버 | CPU(용도별) · load average · 메모리 · 디스크 남은 용량 · 디스크 읽기/쓰기 · 서버 네트워크 | `a301-node`, 네트워크만 `a301-cadvisor` |
| BE · AI | 개발 서버와 같은 패널(요청 · 5xx · 응답 시간 · DB 풀 · JVM · AI 큐 · AI 실패) | `a301-be` · `a301-health` |
| BE 상세 | 엔드포인트별 p95 · 요청 수 · 최대 응답 시간, 응답 결과(4xx · 5xx), 5xx 예외, ERROR · WARN 로그 수, 주기 작업 시간 · 실패, DB 연결 획득 대기, 리포지토리 메서드 시간, Redis 명령 지연(BLMOVE 제외), GC 부담, 스레드 상태 | `a301-be` |
| AI 면접 에이전트 | 지표 수집 상태, 진행 중 면접(LiveKit 방 수와 비교), 선택 기간 Soniox 음성 · ElevenLabs 글자 · Jev 요청 수, Jev 결과 · 실패 비율 | `a301-ai-agent` |
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
- 흐름별 오류 · 경고: BE(예외 스택 포함), 면접 진행(AI 에이전트), 분석 작업(질문 생성 · 채점 · 녹화 합치기 작업자 3개), 미디어 · 녹화(LiveKit · Egress), Nginx 5xx 응답, 기동 · 재시작 로그
- 소요 시간 · 사용량(로그의 `ms=` · 토큰 값으로 계산): 에이전트 외부 호출(Jev · 질문 음성 합성 · 꼬리질문) p95, GMS 호출 p95 · 실패 · 재시도, 분석 작업 처리 시간 · 큐 대기 시간 p95 · 결과 건수, GMS 토큰 사용량

로그에 개인정보(이메일 · 자소서 · 답변 원문 · 토큰)를 남기지 않는 것이 조건이다.

## 서버에 미리 해 둔 것

배포 계획 3.1 · 4.2 · 5.2 · 11장. 2026-10-26에 다시 확인했다.

- Docker 29.9 · Compose v5.6, 스왑 4GB, 시간대 `Asia/Seoul`, 로그 10MB × 3
- ufw: 22 · 80/tcp · 7881/tcp · 7882/udp · 3478/udp · 443/tcp
- SSH(11/06): `/etc/ssh/sshd_config.d/10-a301-hardening.conf`에 `PermitRootLogin no` · `AllowUsers ubuntu` · `MaxAuthTries 4` · `X11Forwarding no`. 바꿀 때는 SSH 창을 하나 더 열어 두고 `systemd-run --on-active=5min`으로 자동 되돌리기를 걸어 둔 뒤 `sshd -t` → `systemctl reload ssh` → 새 접속 시험 순서로 한다(브라우저 SSH를 쓰지 않아 잠기면 들어갈 길이 없다)
- fail2ban(11/06): `/etc/fail2ban/jail.d/a301-sshd.local`(10분 5회 실패 → 1시간 차단, SSAFY 공인 IP 제외, `journalmatch`는 `ssh.service`). 상태는 `sudo fail2ban-client status sshd`
- 인증서(certbot + Cloudflare DNS 플러그인, `certbot.timer`가 하루 두 번 갱신을 본다). LiveKit · Nginx 이미지는 root로 돌아 그대로 읽는다
  - TURN `/etc/letsencrypt/live/turn.hangguet.co.kr/`: 갱신 뒤 `renewal-hooks/deploy/restart-livekit.sh`가 `a301-prod-livekit`을 재시작
  - 웹 `/etc/letsencrypt/live/hangguet.co.kr/`(`hangguet.co.kr` · `rtc.` · `grafana.`, 11/06 발급): 갱신 뒤 `renewal-hooks/deploy/reload-nginx.sh`가 `a301-prod-nginx`를 reload(접속이 끊기지 않음)
  - 두 hook은 `$RENEWED_LINEAGE`로 자기 인증서일 때만 동작한다. 왜: 이 폴더의 hook은 어느 인증서가 갱신되든 모두 실행되어, 그대로 두면 웹 인증서 갱신 때도 LiveKit이 재시작돼 면접이 끊긴다
- 러너 `a301-prod`(protected, shell), 러너 계정은 docker 그룹. 배포 폴더 `/opt/a301`(러너 계정 전용), 백업 폴더 `/opt/a301/backup`
- 백업 cron(러너 계정): `30 4 * * * /opt/a301/backup.sh >> /opt/a301/backup/backup.log 2>&1`. DB 컨테이너가 없으면 건너뛴다
- 공개 이미지(LiveKit · Egress · Nginx · cloudflared · 모니터링 · aws-cli)를 미리 받아 두었다

## 개발 서버와 다른 설정

키 값과 이미지 출처 말고 개발 서버와 다르게 둔 것은 아래뿐이다. 늘릴 때는 배포 계획에 이유를 남긴다.

- Swagger를 공개하지 않는다: BE `SPRINGDOC_API_DOCS_ENABLED=false` · `SPRINGDOC_SWAGGER_UI_ENABLED=false`, Nginx에서 `/be/docs` · `/be/swagger-ui` · `/be/v3/api-docs` 404(배포 계획 3.2)
- FE 지표(`A301_DEV_MONITORING`)를 켜지 않는다(아래)
- Nginx 요청 수 제한 · 보안 헤더, Nginx · LiveKit 컨테이너 MPTCP 끄기(배포 계획 5.2 「보안 설정」). 개발 서버는 Tunnel 뒤라 넣지 않았다
- BE 메모리 상한 1280m(개발 768m), JVM 옵션에 `-XX:+ExitOnOutOfMemoryError`를 더한다. 힙을 다 쓰면 약 1.06GB를 써 768m로는 강제 종료될 수 있어서다(배포 계획 3.2)

## 아직 없는 것

- FE 지표(`A301_DEV_MONITORING`)는 개발 서버에서만 켠다. 그래서 운영 대시보드에는 브라우저 오류 · Web Vitals 패널이 없다
- 알림(디스크 · 메모리 임계치)은 배포 계획 3.3에서 [미정]이다. 지금은 대시보드 색으로만 본다
