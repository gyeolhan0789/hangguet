# ASG 인스턴스 키트 (에이전트 · Egress)

AI 면접관(에이전트)과 녹화(Egress)를 운영 메인 서버에서 떼어 우리 AWS 계정의 Auto Scaling Group 두 개로 띄울 때 쓰는 파일이다. 기준 문서는 [에이전트 · Egress 오토스케일링 계획](../../이해준/agent_autoscale_plan/README.md)이다.

> **운영에는 GitLab 변수 `AGENT_ASG_ENABLED=true`를 넣는 날부터 쓴다.** CI가 읽는 것은 `ci-agent-refresh.sh` 하나다(운영 배포 `prod-deploy`가 메인 서버 배포 뒤 부른다). 이 스크립트는 GitLab 변수 `AGENT_ASG_ENABLED=true`일 때만 동작하고, 그 전에는 아무것도 하지 않는다. 나머지 파일은 운영 배포(`deploy/prod/deploy.sh`는 `deploy/prod/`만 서버로 복사한다)와 CI 어디에서도 읽지 않는다.

## 파일

| 파일 | 내용 |
|---|---|
| `build.sh` | 시작 템플릿에 붙여 넣을 user data를 만든다(`bootstrap.sh` + `watcher.sh` + `alloy.alloy`, 16KB 상한 확인) |
| `bootstrap.sh` | user data 본문: Docker · Tailscale 설치, SSM 값 읽기, 역할 컨테이너 · Alloy · 감시 스크립트 실행 |
| `watcher.sh` | 감시 스크립트(인스턴스의 `/usr/local/bin/a301-watcher`): 수명 주기 훅 처리, 축소 보호 켜고 끄기, 준비 확인 |
| `alloy.alloy` | 인스턴스의 지표 · 로그를 메인 Prometheus(원격 쓰기) · Loki로 보낸다 |
| `iam/agent-instance-policy.json` · `iam/egress-instance-policy.json` | 인스턴스 역할 인라인 정책(+ AWS 관리형 `AmazonSSMManagedInstanceCore`) |
| `ci-agent-refresh.sh` | 운영 배포(`prod-deploy`) 뒤 SSM `image-tag`를 이번 SHA로 바꾸고 `a301-prod-agent` 인스턴스 새로 고침을 시작한다(계획 7.1). `AGENT_ASG_ENABLED=true`일 때만 |
| `iam/ci-agent-refresh-policy.json` | `ci-agent-refresh.sh`가 쓰는 IAM 사용자 `a301-prod-agent-ci` 정책(태그 매개변수 쓰기 · 이 ASG 새로 고침뿐) |
| `../prod/compose.asg.yml` | (운영 배포 폴더에 있음) 메인 서버 compose 덮어쓰기: 에이전트 끄기, Tailscale IP에 7880 · 6379 · 9090 · 3100 열기, LiveKit `tcp_retries2=8`. `deploy.sh`가 `AGENT_ASG_ENABLED=true`일 때만 더한다 |
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

- 15초마다 IMDS `autoscaling/target-lifecycle-state`를 보고, `Terminated`면 `docker stop --time 3900`(SIGTERM: 새 일은 받지 않고 진행 중 면접 · 녹화를 마친 뒤 종료) → `complete-lifecycle-action`
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
| 수명 주기 훅 | `a301-prod-agent-drain`, 종료 시, 제한 시간 3900초, 기본 결과 CONTINUE | `a301-prod-egress-drain` |
| 확장 정책 | 대상 추적 평균 CPU 40%, 준비 시간 180초(3단계 뒤에 켠다) | 같음(9장 Egress 몰림 뒤에 켠다) |

## 메인 서버 전환(계획 10.1)

운영 배포(`deploy/prod/deploy.sh`)가 GitLab 변수로 구성을 바꾼다. 서버에서 compose를 직접 고치지 않는다.

| 변수(범위 `prod/*`) | 없을 때(지금) | `AGENT_ASG_ENABLED=true`일 때 |
|---|---|---|
| compose 파일 | `compose.yml` | `compose.yml` + `../prod/compose.asg.yml` |
| 메인 서버 에이전트 | 돈다 | 끈다(남아 있으면 `docker stop --time 3900`으로 drain 뒤 지움) |
| Egress | 메인 서버 | 메인 서버(`EGRESS_ASG_ENABLED=true`가 아니면 `egress-on-main` 프로필을 켠다) |
| LiveKit 7880 · Redis 6379 · Prometheus 9090 · Loki 3100 | 열지 않음 | `MAIN_TAILSCALE_IP`에만 연다 |
| 에이전트 새 버전 반영 | 없음 | `ci-agent-refresh.sh`(SSM 태그 + 인스턴스 새로 고침) |

Redis 비밀번호(`REDIS_PASSWORD`)는 `compose.yml`에 늘 켜져 있다(변수가 없으면 배포가 멈춘다).

순서
1. 운영 리소스를 원하는 대수 0으로 만든다(위 「리소스」, SSM `/a301/prod/agent/*`, IAM 사용자 `a301-prod-agent-ci`)
2. 운영 메인 서버에서 `sudo bash deploy/asg/main-tailscale.sh prod` → 출력된 IP를 GitLab `MAIN_TAILSCALE_IP`와 SSM `livekit-url`(`ws://<IP>:7880`) · `redis-host` · `metrics-url` · `loki-url`에 넣는다
3. GitLab `AGENT_REFRESH_AWS_ACCESS_KEY_ID` · `AGENT_REFRESH_AWS_SECRET_ACCESS_KEY`(Protected · Masked)
4. ASG 원하는 대수 1 → 인스턴스가 tailnet에 가입하는지 본다. 이때 7880 · 6379가 아직 Tailscale에 열려 있지 않아 LiveKit에는 붙지 못한다(감시 스크립트가 준비 확인 실패를 기록하지만 5번 연속 전에 다음 단계로 간다)
5. GitLab `AGENT_ASG_ENABLED=true` → `prod-deploy` Re-deploy. 메인 서버 에이전트가 내려가고, 포트가 열리고, 이어서 ASG 새로 고침이 돈다
6. ASG 에이전트가 LiveKit에 등록됐는지(`docker logs a301-prod-livekit | grep "worker registered"`) 보고 화상 면접 1건으로 끝까지 확인한다
7. 되돌리기: `AGENT_ASG_ENABLED`를 지우고 `prod-deploy` Re-deploy(메인 서버 에이전트가 다시 뜨고 포트가 닫힌다) → ASG 원하는 대수 0

4번에서 기다리는 사이 감시 스크립트가 5번 연속 실패해 인스턴스를 비정상으로 알리면 ASG가 교체한다(대수는 그대로). 해가 없지만, 4 → 5를 5분 안에 하거나 4번을 5번 뒤로 미뤄도 된다. 그러면 5번 직후 잠깐(약 2분) 에이전트가 없어 새 면접은 BE가 `START_FAILED`로 돌린다

## 확인하지 못한 것

이 키트는 문법 검사(`bash -n`, user data 빌드)까지만 했다. 실제 동작은 테스트 환경(계획 9장)에서 확인한다.

- ~~Tailscale 설치 · OAuth 가입(AL2023), 컨테이너 → Tailscale IP, Alloy 지표 · 로그, 축소 보호 켜고 끄기~~ 11/06 테스트에서 확인(부팅 약 50초 뒤 가입 · 직접 연결 1ms, 면접을 받고 약 20초 뒤 보호 on)
- IMDS `target-lifecycle-state`가 종료 대기 중에 `Terminated`로 보이는지, 훅 완료 뒤 바로 종료되는지
- Egress가 루프백 8080에 상태를 응답하는지, `livekit_egress_requests` 값이 진행 중 녹화 수와 맞는지
- ~~LiveKit 서버가 `REDIS_PASSWORD`로 Redis에 붙는지~~ 11/06 테스트 서버에서 확인
