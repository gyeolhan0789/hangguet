# ASG 인스턴스 키트 (에이전트 · Egress)

AI 면접관(에이전트)과 녹화(Egress)를 운영 메인 서버에서 떼어 우리 AWS 계정의 Auto Scaling Group 두 개로 띄울 때 쓰는 파일이다. 기준 문서는 [에이전트 · Egress 오토스케일링 계획](../../이해준/agent_autoscale_plan/README.md)이다.

> **아직 운영에 쓰지 않는다.** 다음 릴리즈에는 ASG를 넣지 않는다(11/05). 이 폴더는 운영 배포(`deploy/prod/deploy.sh`는 `deploy/prod/`만 서버로 복사한다)와 CI 어디에서도 읽지 않으므로, 여기 파일을 고쳐도 운영 릴리즈에 영향이 없다.

## 파일

| 파일 | 내용 |
|---|---|
| `build.sh` | 시작 템플릿에 붙여 넣을 user data를 만든다(`bootstrap.sh` + `watcher.sh` + `alloy.alloy`, 16KB 상한 확인) |
| `bootstrap.sh` | user data 본문: Docker · Tailscale 설치, SSM 값 읽기, 역할 컨테이너 · Alloy · 감시 스크립트 실행 |
| `watcher.sh` | 감시 스크립트(인스턴스의 `/usr/local/bin/a301-watcher`): 수명 주기 훅 처리, 축소 보호 켜고 끄기, 준비 확인 |
| `alloy.alloy` | 인스턴스의 지표 · 로그를 메인 Prometheus(원격 쓰기) · Loki로 보낸다 |
| `iam/agent-instance-policy.json` · `iam/egress-instance-policy.json` | 인스턴스 역할 인라인 정책(+ AWS 관리형 `AmazonSSMManagedInstanceCore`) |
| `iam/ci-agent-refresh-policy.json` | 나중에 CI가 에이전트를 새로 고칠 IAM 사용자 정책(계획 7.1) |
| `redis-password.yml` | 메인 서버 compose 덮어쓰기: Redis 비밀번호 켜기(전환 전에 먼저) |
| `main-override.yml` | 메인 서버 compose 덮어쓰기: 에이전트 · Egress 끄기, Tailscale IP에 7880 · 6379 · 9090 · 3100 열기 |
| `main-tailscale.sh` | 메인 서버(운영 · 테스트)를 Tailscale에 태그 기기로 가입시키고 재부팅 때 포트 묶기를 켠다. `MAIN_TAILSCALE_IP`를 출력한다 |

## user data 만들기

```bash
bash deploy/asg/build.sh agent prod > user-data-agent.sh
bash deploy/asg/build.sh egress prod > user-data-egress.sh
```

만든 파일은 커밋하지 않는다(시작 템플릿에 붙여 넣는 용도). 테스트 환경은 `prod` 대신 `loadtest`를 주면 SSM `/a301/loadtest/<역할>/*`를 읽는다.

## 인스턴스에서 일어나는 일

| 단계 | 에이전트(`a301-prod-agent`, `t3.small`) | Egress(`a301-prod-egress-node`, `t3.medium`) |
|---|---|---|
| 컨테이너 | `a301-ai-agent`: AI 이미지 `hanggeut/a301:ai-<image-tag>`, `--memory 1536m` | `a301-egress`: `egress-image`(예: `livekit/egress:v1.15.0`), `--memory 3g`, `--stop-signal SIGTERM` |
| 상태 · 지표(루프백) | 8081 · 9464 | 8080 · 9090 |
| 축소 보호 기준 | `a301_agent_active_interviews` 합 | `livekit_egress_requests` 합 |
| 수명 주기 훅 이름 | `a301-prod-agent-drain` | `a301-prod-egress-drain` |
| Tailscale 태그 | `tag:a301-agent`(테스트 `tag:a301-loadtest-agent`) | `tag:a301-egress`(테스트 `tag:a301-loadtest-egress`) |

감시 스크립트(`a301-watcher.service`)

- 15초마다 IMDS `autoscaling/target-lifecycle-state`를 보고, `Terminated`면 `docker stop --time 1800`(SIGTERM: 새 일은 받지 않고 진행 중 면접 · 녹화를 마친 뒤 종료) → `complete-lifecycle-action`
- 1분마다 진행 중 수가 1 이상이면 축소 보호를 켜고 0이면 끈다(바뀔 때만 API 호출, 지표를 못 읽으면 그대로 둔다)
- 1분마다 Tailscale · LiveKit 7880 · Redis(AUTH · PING) · 컨테이너 상태 포트를 보고, 5번 연속 실패하면 `set-instance-health Unhealthy`(유예 기간은 지킨다)
- 기록: `journalctl -u a301-watcher`, 시작 기록: `/var/log/a301-userdata.log`

## SSM 매개변수

이름 앞부분은 `/a301/prod/agent/` · `/a301/prod/egress/`다. 비밀값은 SecureString(기본 키 `aws/ssm`). 값은 GitLab `prod/*` 변수와 같게 넣는다.

| 이름 | 에이전트 | Egress | 값 |
|---|---|---|---|
| `livekit-url` | 필수 | 필수 | `ws://<메인 서버 Tailscale IP>:7880` |
| `livekit-api-key` · `livekit-api-secret` | 필수 | 필수 | GitLab `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET` |
| `redis-host` | 필수 | 필수 | `<메인 서버 Tailscale IP>` |
| `redis-password` | 선택 | 선택 | GitLab `REDIS_PASSWORD`. 운영은 필수(계획 5.2) |
| `tailscale-auth-key` | 선택 | 선택 | Tailscale OAuth 클라이언트 비밀값(운영 · 테스트 따로). 없으면 Tailscale을 설치하지 않는다(같은 VPC 사설망 시험) |
| `metrics-url` · `loki-url` | 선택 | 선택 | `http://<Tailscale IP>:9090/api/v1/write` · `http://<Tailscale IP>:3100/loki/api/v1/push`. 둘 다 있어야 Alloy를 띄운다 |
| `image-tag` | 필수 | – | 운영 배포와 같은 커밋 짧은 SHA(계획 7.1) |
| `dockerhub-user` · `dockerhub-token` | 필수 | – | 에이전트 전용 읽기 토큰(`a301-prod-agent-pull`) |
| `soniox-api-key` | 필수 | – | |
| `elevenlabs-api-key` · `jev-api-key` | 선택 | – | 없으면 질문 음성 · 리액션 없이 진행 |
| `llm-chat-url` · `llm-model` · `llm-api-key` | 선택 | – | 꼬리질문(GMS). 운영 compose의 `x-gms-env`와 같은 값 |
| `idle-processes` · `soniox-stt-model` | 선택 | – | `AGENT_IDLE_PROCESSES`(없으면 CPU 수 = 2) · 기본 `stt-rt-v5` |
| `egress-image` | – | 필수 | 운영 LiveKit 서버와 짝이 맞는 버전 |

- 비밀값에 공백 · 따옴표를 넣지 않는다. Egress 설정이 한 줄 JSON이고, 감시 스크립트가 Redis에 인라인 명령으로 보낸다
- 필수 값이 하나라도 없으면 user data가 멈추고 컨테이너가 뜨지 않는다(`/var/log/a301-userdata.log`)

## 리소스(우리 계정 콘솔)

계획 7장 표와 같다. 처음에는 **원하는 대수 0**으로 만들어 두면 비용이 없다.

| 리소스 | 에이전트 | Egress |
|---|---|---|
| IAM 역할 | `a301-prod-agent` + `iam/agent-instance-policy.json` | `a301-prod-egress-node` + `iam/egress-instance-policy.json` |
| 보안 그룹 | 인바운드 UDP 41641(Tailscale)만 | 같음 |
| 시작 템플릿 | Amazon Linux 2023(x86), `t3.small`, 크레딧 unlimited, IMDSv2만, gp3 30GiB, 세부 모니터링, user data = `build.sh agent prod` | `t3.medium`, user data = `build.sh egress prod`, 나머지 같음 |
| ASG | 최소 · 원하는 · 최대 1 · 1 · 5(처음 0 · 0 · 5), 기본 VPC `2a` · `2b`, 상태 확인 EC2 · 유예 300초 | 1 · 1 · 2(처음 0 · 0 · 2) |
| 수명 주기 훅 | `a301-prod-agent-drain`, 종료 시, 제한 시간 1800초, 기본 결과 CONTINUE | `a301-prod-egress-drain` |
| 확장 정책 | 대상 추적 평균 CPU 40%, 준비 시간 180초(3단계 뒤에 켠다) | 같음(9장 Egress 몰림 뒤에 켠다) |

## 메인 서버 전환(계획 10.1)

1. `redis-password.yml`을 먼저 적용한다(AI가 `REDIS_PASSWORD`를 읽는 코드가 들어간 뒤). LiveKit은 `REDIS_PASSWORD` 환경 변수를 읽는다(v1.13.10 소스 확인, 실제 접속은 테스트 서버에서 확인)
2. `sudo bash main-tailscale.sh prod`로 Tailscale에 가입(`tag:a301-main`)하고 `MAIN_TAILSCALE_IP`를 정한다
3. ASG 원하는 대수 1 → 면접 1건 확인 → `main-override.yml`을 더해 메인 서버의 에이전트 · Egress를 끈다. `prometheus.yml`의 `a301-ai-agent` · `a301-egress` 수집 작업은 지운다
4. 되돌리기: `--profile agent-on-main --profile egress-on-main`으로 메인 서버 쪽을 다시 켠 뒤 ASG 원하는 대수를 0으로 낮춘다

지금의 `deploy.sh`는 `compose.yml` 하나만 쓴다. 덮어쓰기 파일을 운영 배포에 넣는 방법(파일을 `deploy/prod`로 옮기고 `deploy.sh`가 더하게 하기)은 전환을 정할 때 같이 바꾼다.

## 확인하지 못한 것

이 키트는 문법 검사(`bash -n`, user data 빌드)까지만 했다. 실제 동작은 테스트 환경(계획 9장)에서 확인한다.

- Tailscale 설치 스크립트 · OAuth 가입이 Amazon Linux 2023에서 되는지, 컨테이너에서 Tailscale IP로 나가는지
- IMDS `target-lifecycle-state`가 종료 대기 중에 `Terminated`로 보이는지, 훅 완료 뒤 바로 종료되는지
- Egress가 루프백 8080에 상태를 응답하는지, `livekit_egress_requests` 값이 진행 중 녹화 수와 맞는지
- LiveKit 서버가 `REDIS_PASSWORD`로 Redis에 실제로 붙는지(소스로는 확인함)
