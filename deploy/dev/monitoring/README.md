# 개발 서버 모니터링

이 Compose는 A301 개발 서버 앱과 별도로 실행한다. Prometheus는 A301의 FE·BE·AI 상태, BE 요청·JVM·DB 풀·AI 큐 지표, AI 면접 에이전트 지표(`a301-dev-ai-agent:9464`), FE 첫 화면과 실제 브라우저 지표를 수집한다. 호스트나 다른 프로젝트의 컨테이너 지표는 수집하지 않는다.

로그는 Alloy가 `a301-dev-*` 컨테이너의 stdout · stderr를 읽어 Loki에 3일 동안 저장한다. 팀원은 서버에 들어가지 않고 Grafana의 **A301 개발 서버 로그** 대시보드에서 본다. 컨테이너를 다시 만들어도(재배포) 로그가 남는다. 다른 프로젝트 컨테이너 로그는 모으지 않는다.

## 준비

- 먼저 `deploy/dev/compose.yml`로 앱을 띄워 `a301-dev` Docker 네트워크를 만든다. 미니PC의 기존 Nginx가 사용하는 `server_public-network`도 필요하다.
- BE에는 관리 포트 8081이 켜져 있어야 한다. 개발 서버 Compose가 설정한다.
- GitLab CI/CD Variables의 `GRAFANA_ADMIN_PASSWORD`(Protected · Masked, 범위 All)를 쓴다. 운영 서버 Grafana와 같은 값이다(운영 배포 계획 7장). Grafana는 데이터 볼륨을 처음 만들 때만 이 값을 적용하므로, 이미 뜬 Grafana의 비밀번호를 바꾸려면 Grafana에서 직접 바꾼다. 명령 기록이나 저장소에 비밀번호를 적지 않는다.
- Cloudflare Tunnel의 Public Hostname `hangguet-grafana.yobistory.com`을 미니PC의 **기존 Nginx HTTP 80 서비스**로 연결한다. 기존 `hangguet.yobistory.com`과 같은 Tunnel/Nginx를 사용한다.
- `nginx.conf.example`의 별도 `server` 블록을 미니PC의 활성 Nginx 설정에 추가한다. 기존 `hangguet.yobistory.com` 블록은 유지한다. 적용 전 `nginx -t`, 적용 후 `nginx -s reload`로 반영한다. Nginx 컨테이너가 `server_public-network`에 연결되어 있어야 한다.

## Runner 배포

모니터링 Compose·Prometheus·blackbox·Loki(`loki.yml`)·Alloy(`alloy.alloy`) 설정 또는 Grafana 프로비저닝·대시보드가 `develop`에서 바뀌면 `monitoring-deploy` 잡이 미니PC의 배포 전용 Runner에서 자동 실행된다. README나 Nginx 설정 예시만 바뀌면 자동 실행되지 않는다. 다른 `develop` push 파이프라인과 수동 파이프라인에는 `monitoring-deploy` 수동 실행 버튼이 생긴다. 버튼을 누르지 않으면 앱 변경만으로 Grafana를 다시 배포하지 않는다.

잡은 아래 명령을 실행하고 `http://127.0.0.1:18090/api/health`로 기동을 확인한다. Loki · Alloy는 20초 뒤에도 실행 중이고 재시작이 없는지 본다(설정이 틀리면 재시작을 반복한다). Compose 설정이 그대로라면 `up -d`는 컨테이너를 다시 만들지 않는다.

설정 파일(`prometheus.yml` · `blackbox.yml` · `loki.yml` · `alloy.alloy` · `grafana/`)만 바뀌면 `up -d`가 컨테이너를 그대로 두고, 컨테이너 안의 파일은 새 내용이어도 프로세스는 예전 설정을 계속 쓴다(Grafana 대시보드 포함). 그래서 잡은 `up -d` 전에 설정 파일 해시를 `A301_*_CONFIG_HASH` 환경 변수로 넘기고, compose가 이를 라벨 `a301.config-hash`로 붙인다. 해시가 바뀐 서비스만 다시 만들어진다. 지표 · 로그 · Grafana 계정은 볼륨에 있어 남는다. 로컬에서 변수 없이 띄우면 라벨이 비어 있어, 그다음 잡이 한 번 모두 다시 만든다.

```sh
docker compose -f deploy/dev/monitoring/compose.yml config --quiet
docker compose -f deploy/dev/monitoring/compose.yml up -d
```

브라우저 주소는 **https://hangguet-grafana.yobistory.com/** 이다. 외부 요청은 Cloudflare Tunnel → 기존 Nginx → `a301-dev-grafana:3000`으로 간다. Grafana 로그인은 필수이고 익명 접속은 꺼져 있다. 필요하면 Cloudflare Access 정책을 추가한다. Prometheus와 blackbox exporter는 공용 Nginx 네트워크나 호스트 포트에 연결하지 않는다. Grafana의 `127.0.0.1:18090` 포트는 Runner 헬스체크용으로 유지한다. Grafana 데이터 소스와 대시보드는 `grafana/` 파일에서 자동 등록된다.

로컬 실행 시에는 비밀번호가 환경 변수에 있어야 한다. Git에 포함되지 않는 루트 `.env`를 사용하는 경우, 위 명령에 모두 `--env-file .env`를 `-f` 앞에 추가한다. `.env`에는 DB·JWT·Grafana 비밀번호가 있으므로 공유하지 않는다. 로컬 접속 주소는 `http://127.0.0.1:18090/`이다.

## 로그 보기

1. https://hangguet-grafana.yobistory.com/ 에 로그인한다. 팀원 계정은 보기 권한(Viewer)으로 만든다
2. 대시보드 → A301 → **A301 개발 서버 로그**
3. 위의 **서비스**에서 보고 싶은 컨테이너(예: `a301-dev-be`, `a301-dev-ai-analysis`)를 고르고, **검색어**에 찾을 글(예: `ERROR`, 면접 id)을 넣는다. 오른쪽 위에서 기간을 바꾼다
4. 위 그래프는 서비스별 오류 · 예외 줄 수다. 막대가 솟은 시점을 누르면 그 시간대 로그로 좁힐 수 있다

- 보관: 3일(`loki.yml`). 그보다 오래된 로그는 자동으로 지워진다
- 라벨: `service`(compose 서비스 이름), `container`(컨테이너 이름), `env`(`dev`)
- Viewer는 기본 설정에서 Explore(자유 검색)를 쓸 수 없어 대시보드로 본다. 자유 검색이 필요하면 관리자가 Explore에서 `{env="dev", service="a301-dev-be"}`처럼 조회한다
- 로그에는 답변 내용 등 테스트 데이터가 섞일 수 있다. 개발 서버에는 실제 사용자 데이터를 쓰지 않는다(운영 배포 계획 4.0)
- Alloy는 로그를 읽으려고 Docker 소켓을 읽기 전용으로 붙인다. 읽기 전용이어도 Docker API 호출을 막지는 못하므로 공식 이미지 · 고정 버전만 쓴다

## 확인

- Grafana의 **A301 개발 서버** 대시보드에서 FE·BE·AI 상태가 `UP`인지 본다.
- 도메인에서 로그인 화면이 열리지 않으면 Tunnel Public Hostname, Nginx의 `server_name`과 `server_public-network` 연결을 차례로 확인한다. Runner의 헬스체크는 도메인 연결까지 검사하지 않는다.
- BE 지표 수집이 `UP`인지 본다. 요청이 없으면 평균·p95 응답 시간은 비어 있고 요청 건수·5xx는 0이다. p95는 BE의 요청 히스토그램이 켜진 뒤 들어온 요청을 기동 시점부터 누적해 계산한다.
- FE 첫 화면 검사 응답 시간은 서버 간 HTTP 검사 결과다. 실제 사용자 지표(TTFB·FCP·LCP·INP)와 브라우저 오류는 개발 서버 FE를 사용한 브라우저가 보고한다. Web Vitals p75는 FE 기동 시점부터 누적한 값이며, 방문이나 상호작용이 없으면 해당 패널이 비어 있을 수 있다. 오류 내용·URL·사용자 식별자는 수집하지 않는다.
- AI 작업 큐는 Redis 작업 큐(`ai:jobs` · `ai:jobs:plan` · `ai:jobs:recording`, AI 명세 1.3)의 대기·처리 중 길이를 큐별로 보여 준다. BE 지표에 큐 이름(`queue`)이 붙기 전에는 한 줄로 보인다. AI 실패 패널은 실패한 면접의 현재 누적 수와 BE가 재처리하지 못해 `ai:results:failed`에 둔 메시지 수다. 모든 AI 모델 호출 실패를 뜻하지는 않는다.
- **AI 면접 에이전트** 줄의 「에이전트 지표 수집」이 `UP`인지 본다. 진행 중 면접 수와 Soniox · ElevenLabs · Jev 사용량은 면접이 진행돼야 생긴다(면접 처리 프로세스가 기록한다). 면접이 없으면 0이나 No data다.
- **BE 상세** 줄은 엔드포인트별 응답 시간 · 오류, ERROR · WARN 로그 수, 주기 작업, DB 연결 대기, Redis 지연(BLMOVE 제외), GC 부담을 보여 준다. 인증 전에 막힌 요청(`uri="UNKNOWN"`)과 없는 경로(`/**`)는 엔드포인트별 패널에서 뺀다.
- **A301 개발 서버 로그**의 「소요 시간 · 사용량」 줄은 로그의 `ms=` · 토큰 값으로 그린다(에이전트 외부 호출, GMS 호출, 분석 작업 처리 · 큐 대기 시간, GMS 토큰). 해당 로그가 없으면 비어 있다.
- **A301 개발 서버 로그** 대시보드의 서비스 목록에 `a301-dev-*`만 보이고, 고른 서비스의 최근 로그가 나오는지 본다.
- `docker compose -f deploy/dev/monitoring/compose.yml restart` 후에도 이전 지표와 Grafana 설정이 남는지 본다.

Prometheus는 30초마다 수집하고, 데이터는 최대 3일 또는 512MB까지 보존한다. Loki는 로그를 3일 보존한다(로컬 시험에서 메모리 Loki 약 65MB · Alloy 약 50MB). Compose의 메모리 상한은 시작값이므로 실제 미니PC 여유 자원과 사용량을 확인한 뒤 조정한다. `down -v`는 저장된 지표와 Grafana 계정을 지우므로 사용하지 않는다. Grafana 관리자 비밀번호 환경 변수는 첫 데이터 볼륨 생성 때 적용되며, 기존 볼륨의 암호를 바꾸려면 Grafana에서 변경해야 한다.
