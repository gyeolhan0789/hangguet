# 개발 서버 모니터링

이 Compose는 A301 개발 서버 앱과 별도로 실행한다. Prometheus는 A301의 FE·BE·AI 상태, BE 요청·JVM·DB 풀·AI 큐 지표, FE 첫 화면과 실제 브라우저 지표를 수집한다. 호스트나 다른 프로젝트의 컨테이너 지표는 수집하지 않는다.

## 준비

- 먼저 `deploy/dev/compose.yml`로 앱을 띄워 `a301-dev` Docker 네트워크를 만든다. 미니PC의 기존 Nginx가 사용하는 `server_public-network`도 필요하다.
- BE에는 관리 포트 8081이 켜져 있어야 한다. 개발 서버 Compose가 설정한다.
- GitLab CI/CD Variables에 개발 서버 전용 `DEV_GRAFANA_ADMIN_PASSWORD`를 Masked 변수로 등록한다. Environment scope는 `dev/monitoring`으로 둔다. `develop`이 보호 브랜치인 경우 Protected도 적용한다. 운영 서버의 Grafana 비밀번호와 값도 분리한다. 명령 기록이나 저장소에 비밀번호를 적지 않는다.
- Cloudflare Tunnel의 Public Hostname `hangguet-grafana.yobistory.com`을 미니PC의 **기존 Nginx HTTP 80 서비스**로 연결한다. 기존 `hangguet.yobistory.com`과 같은 Tunnel/Nginx를 사용한다.
- `nginx.conf.example`의 별도 `server` 블록을 미니PC의 활성 Nginx 설정에 추가한다. 기존 `hangguet.yobistory.com` 블록은 유지한다. 적용 전 `nginx -t`, 적용 후 `nginx -s reload`로 반영한다. Nginx 컨테이너가 `server_public-network`에 연결되어 있어야 한다.

## Runner 배포

`deploy/dev/monitoring/` 변경이 `develop`에 반영되면 `monitoring-deploy` 잡이 미니PC의 배포 전용 Runner에서 자동 실행된다. 앱 배포가 같은 파이프라인에 있으면 BE 배포 완료를 기다린다. 다른 `develop` push 파이프라인과 수동 파이프라인에는 `monitoring-deploy` 수동 실행 버튼이 생긴다. 버튼을 누르지 않으면 앱 변경만으로 Grafana를 다시 배포하지 않는다.

잡은 아래 명령을 실행하고 `http://127.0.0.1:18090/api/health`로 기동을 확인한다. 설정이 그대로라면 `up -d`는 컨테이너를 다시 만들지 않는다.

```sh
docker compose -f deploy/dev/monitoring/compose.yml config --quiet
docker compose -f deploy/dev/monitoring/compose.yml up -d
```

브라우저 주소는 **https://hangguet-grafana.yobistory.com/** 이다. 외부 요청은 Cloudflare Tunnel → 기존 Nginx → `a301-dev-grafana:3000`으로 간다. Grafana 로그인은 필수이고 익명 접속은 꺼져 있다. 필요하면 Cloudflare Access 정책을 추가한다. Prometheus와 blackbox exporter는 공용 Nginx 네트워크나 호스트 포트에 연결하지 않는다. Grafana의 `127.0.0.1:18090` 포트는 Runner 헬스체크용으로 유지한다. Grafana 데이터 소스와 대시보드는 `grafana/` 파일에서 자동 등록된다.

로컬 실행 시에는 비밀번호가 환경 변수에 있어야 한다. Git에 포함되지 않는 루트 `.env`를 사용하는 경우, 위 명령에 모두 `--env-file .env`를 `-f` 앞에 추가한다. `.env`에는 DB·JWT·Grafana 비밀번호가 있으므로 공유하지 않는다. 로컬 접속 주소는 `http://127.0.0.1:18090/`이다.

## 확인

- Grafana의 **A301 개발 서버** 대시보드에서 FE·BE·AI 상태가 `UP`인지 본다.
- 도메인에서 로그인 화면이 열리지 않으면 Tunnel Public Hostname, Nginx의 `server_name`과 `server_public-network` 연결을 차례로 확인한다. Runner의 헬스체크는 도메인 연결까지 검사하지 않는다.
- BE 지표 수집이 `UP`인지 본다. 요청이 없으면 평균·p95 응답 시간은 비어 있고 요청 건수·5xx는 0이다. p95는 BE의 요청 히스토그램이 켜진 뒤 들어온 요청을 기동 시점부터 누적해 계산한다.
- FE 첫 화면 검사 응답 시간은 서버 간 HTTP 검사 결과다. 실제 사용자 지표(TTFB·FCP·LCP·INP)와 브라우저 오류는 개발 서버 FE를 사용한 브라우저가 보고한다. Web Vitals p75는 FE 기동 시점부터 누적한 값이며, 방문이나 상호작용이 없으면 해당 패널이 비어 있을 수 있다. 오류 내용·URL·사용자 식별자는 수집하지 않는다.
- AI 작업 큐는 Redis `ai:jobs`의 대기·처리 중 길이다. AI 실패 패널은 실패한 면접의 현재 누적 수와 BE가 재처리하지 못해 `ai:results:failed`에 둔 메시지 수다. 모든 AI 모델 호출 실패를 뜻하지는 않는다.
- `docker compose -f deploy/dev/monitoring/compose.yml restart` 후에도 이전 지표와 Grafana 설정이 남는지 본다.

Prometheus는 30초마다 수집하고, 데이터는 최대 3일 또는 512MB까지 보존한다. Compose의 메모리 상한은 시작값이므로 실제 미니PC 여유 자원과 사용량을 확인한 뒤 조정한다. `down -v`는 저장된 지표와 Grafana 계정을 지우므로 사용하지 않는다. Grafana 관리자 비밀번호 환경 변수는 첫 데이터 볼륨 생성 때 적용되며, 기존 볼륨의 암호를 바꾸려면 Grafana에서 변경해야 한다.
