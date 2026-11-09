# Egress ASG 테스트 (2026-11-07, 테스트 서버)

[에이전트 · Egress 오토스케일링 계획](../../이해준/agent_autoscale_plan/README.md) 10.1의 9번(Egress 테스트 서버 재현)과 9장 Egress 행(기능 · drain, 몰림, 줄이기 · 장애)을 진행했다. 테스트 서버의 Egress를 끄고, [`deploy/asg/`](../../deploy/asg/README.md) 키트로 띄운 Egress ASG만 녹화를 받게 했다.

## 요약

- **Egress를 ASG로 옮겨도 녹화 · 합치기 · 다시보기가 된다.**
  - Egress 인스턴스(`t3.medium`)가 Tailscale로 테스트 서버 LiveKit(7880) · Redis(6379, 비밀번호)에 붙어 트랙 녹화 3개(지원자 영상 · 음성, 면접관 음성)를 받았다.
  - 녹화 파일은 테스트 버킷에 올라가 합치기 · 다시보기까지 끝났다.
- **drain이 동작한다.** 녹화 중 `docker stop --time 3900`(SIGTERM)을 보내자 새 녹화를 받지 않고, 진행 중 녹화 3개가 면접이 끝날 때 정상 완료된 뒤 1초 만에 종료했다.
  - 이미지 자체에는 종료 신호 설정이 없다(`StopSignal` 비어 있음). 키트의 `--stop-signal SIGTERM`이 꼭 필요하다.
- **몰림에서 기본 메모리 판정이 녹화를 거절했다. 고쳤다.**
  - 10건을 동시에 시작하자 녹화 30개 중 26개만 받고 4개를 거절했다. 다시보기 2건이 실패했다(`TRACK_NOT_FOUND`).
  - 원인: Egress 기본 메모리 판정(`memory_source: proc_rss`)은 프로세스마다 RSS를 더해 공유 메모리를 여러 번 센다. 실제 컨테이너 메모리 **0.62GB**를 **2.22GB**로 세어 "사용량 + 고정 여유 1GB ≥ `max_memory` 3GB"에 걸렸다. `track_cpu_cost`를 0.05 → 0.03으로 낮춰도 같은 26개에서 막혀 CPU 쪽 문제가 아님을 확인했다.
  - **`memory_source: cgroup`(실제 컨테이너 사용량)으로 바꾸자 녹화 30개를 모두 받았다.** 다시보기 실패 0, Egress CPU 최대 57%, 실제 메모리 0.71GB. 키트(`bootstrap.sh`)에 반영했다.
  - 운영 메인 서버 Egress는 `max_memory`를 쓰지 않아 이 문제가 없다.
- **줄이기는 녹화가 없는 대를 먼저 내린다.** 2대 중 녹화 3개가 몰린 대는 축소 보호로 남고, 0개인 대가 약 1분 만에 내려갔다(훅을 감시 스크립트가 바로 완료).
- **녹화 중 Egress가 갑자기 죽으면 그 면접의 다시보기만 실패한다.** 약 4분 뒤 감시 스크립트가 비정상으로 알려 ASG가 새 대로 바꿨고(새 대 준비 약 3분), 다음 면접 녹화는 정상이었다.
- **`livekit_egress_can_accept_request`는 2코어 인스턴스에서 늘 0이다.** Egress가 "방 전체 합성 녹화에는 4코어가 필요하다"고 판단해서다. 우리가 쓰는 트랙 녹화는 받는다. 이 지표를 상태 확인 · 알림에 쓰면 안 된다(계획 6.5 수정).

## 1. 환경

| 항목 | 값 |
|---|---|
| 메인(테스트) 서버 | `a301-loadtest`(EC2 `t3.xlarge`), 운영 compose + `compose.loadtest.yml` + `deploy/prod/compose.asg.yml`, `--profile agent-on-main`(에이전트는 메인 서버, Egress만 분리), 이미지 `625be166` |
| Egress ASG | `a301-loadtest-egress`, `t3.medium`(unlimited), 시작 템플릿 user data = `bash deploy/asg/build.sh egress loadtest`, 수명 주기 훅 `a301-loadtest-egress-drain`(3900초, CONTINUE), 보안 그룹 `a301-loadtest-agent`(받는 포트 없음) |
| Egress 설정 | `livekit/egress:v1.15.0`, 컨테이너 상한 3g, `cpu_cost`: `track_cpu_cost` 0.05, `max_memory` 3(4회차부터 `memory_source: cgroup`) |
| Tailscale | 테스트 태그 `tag:a301-loadtest-egress`. 메인 서버와 직접 연결 |
| 면접 | `loadtest/scenarios/s5-interview-browser.js`(화상, 질문 5개, 가짜 장치). 로컬 PC 한 대 |

## 2. 결과

### 2.1 기능 · drain (1건)

| 시각(UTC) | 일 |
|---|---|
| 03:51 | Egress 인스턴스 부팅 완료(이미지 받기 → Tailscale 가입 → Egress · Alloy · 감시 스크립트) |
| 04:06:39 | 트랙 녹화 3개 시작(ASG Egress) |
| 04:07:16 | `docker stop --time 3900 a301-egress` → "exit requested, finishing recording then shutting down", `is_terminating=1` |
| 04:07:30 | 감시 스크립트가 축소 보호를 켬 |
| 04:08:26 | 면접 끝 → 녹화 3개 `egress_complete` |
| 04:08:27 | Egress 종료(코드 0) |

- 면접 완료 1, 다시보기 실패 0(준비 0.8초)
- Egress가 꺼진 뒤 감시 스크립트가 준비 확인 실패를 1/5, 2/5로 셌다. 5번이면 비정상으로 알린다(2.3에서 확인)
- 지표 `a301-egress` · `a301-asg-node`(role=egress)가 테스트 Prometheus로 들어왔다

### 2.2 몰림 (Egress 1대)

| 회차 | 시작 | 설정 | 녹화 받음 / 요청 | 다시보기 실패 | Egress CPU 최대(1분) | 실제 메모리 최대 | 메인 서버 CPU 최대 |
|---|---|---|---|---|---|---|---|
| 1 | 5건, 3초 간격 | 0.05, proc_rss | 15 / 15 | 0 | 31% | – | 44% |
| 2 | 10건 동시 | 0.05, proc_rss | 26 / 30 | 2 | 54% | – | 61% |
| 3 | 10건 동시 | 0.03, proc_rss | 26 / 30 | 2 | 54% | 0.62GB(RSS 합 2.22GB) | 59% |
| 4 | 10건 동시 | 0.05, **cgroup** | **30 / 30** | **0** | 57% | 0.71GB(RSS 합 2.55GB) | 57% |

- 거절된 녹화는 Egress가 요청을 받지 않아 LiveKit이 약 20초 기다린 뒤 `failed to launch track egress: no response from servers`를 남겼다. Egress 로그에는 그 요청이 아예 없다
- 테스트 서버 BE(`625be166`)에는 녹화가 시작되지 않은 트랙을 다시 요청하는 기능(`925f8ac`)이 없어, 거절이 그대로 다시보기 실패가 됐다
- 0.1은 재지 않았다. 예약값(15초 동안 잡는 CPU)이 클수록 몰릴 때 덜 받으므로 0.05보다 나쁘다
- 대당 건수: 10건(녹화 30개) 동시 시작에 CPU 57%다. 확장 기준 40%는 대당 약 7건 **[추정]**(계획 2.3의 10~15건보다 낮다). 거절은 10건까지 0이다

### 2.3 줄이기 · 장애 (Egress 2대)

| 시험 | 결과 |
|---|---|
| 줄이기 | 면접 1건의 녹화 3개가 모두 한 대(`i-0cff…`)로 갔다(Egress는 이미 녹화 중인 대를 고른다). 그 대에 축소 보호가 켜진 뒤 원하는 대수를 2 → 1로 낮추자, 녹화 0개인 대가 9초 뒤 `Terminating:Wait` → 11초 뒤 `Proceed` → 약 1분 뒤 종료. 녹화는 정상 완료, 다시보기 정상 |
| 장애 | 녹화 3개를 받은 대에서 `docker kill a301-egress`(05:07:39). 그 면접은 완료됐지만 다시보기 실패(`TRACK_NOT_FOUND`, 예상). 05:11:58 감시 스크립트가 비정상으로 알려 ASG가 종료 · 새 대 시작, 05:15:04 새 대 준비. 다음 면접(다른 대) 녹화 · 다시보기 정상, LiveKit 녹화 오류 0 |

- 장애 뒤 교체까지 약 4분 20초(준비 확인 1분 × 5번)다. 그동안 남은 대가 녹화를 받는다. 1대뿐이면 그 시간 동안 녹화가 빠진다

## 3. 고친 것 · 운영 반영 때 할 일

| 항목 | 내용 |
|---|---|
| `deploy/asg/bootstrap.sh` | Egress 설정에 `memory_source: cgroup` 추가(커밋 전) |
| 계획 6.5 상태 확인 | `livekit_egress_can_accept_request`를 쓰지 않는다(2코어에서 늘 0). 감시 스크립트는 이미 상태 포트(8080)만 본다 |
| 로그 | Egress가 뜰 때마다 `ERROR not enough cpu for some egress types`(방 전체 합성용 4코어 경고)를 남긴다. 로그 대시보드 오류 패널에 잡힌다 |
| BE | 운영 이미지에는 녹화가 시작되지 않은 트랙을 다시 요청하는 기능이 있다(`925f8ac`). 이번 테스트 이미지에는 없어 그 동작은 확인하지 못했다 |

## 4. 확인하지 못한 것

- BE 녹화 다시 요청(`925f8ac`): 테스트 서버 이미지가 그보다 오래됐다
- 10건 넘는 몰림: 노트북 한 대의 브라우저 한계
- 운영 버킷 조건(계획 5.5의 `aws:SourceVpc`): 테스트 버킷에는 IP 조건이 없다
- 에이전트까지 모두 뗀 메인 서버 CPU(계획 9장 "Egress 분리 뒤 메인 서버")
