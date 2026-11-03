# A301 운영 배포 계획

> **이 문서를 고칠 때 지킬 것**
>
> 이 문서는 운영 서버 구성의 기준 문서다. 각 파트(FE · BE · AI · 인프라)가 자기 부분을 직접 고친다.
>
> 1. **무엇을 바꿨는지만 적지 말고, 왜 바꿨는지(이유)와 무엇을 노리는지(의도)를 함께 적는다.** 결정마다 `왜:` 줄을 둔다. 나중에 보는 사람이 "이걸 바꿔도 되는지"를 이유를 보고 판단할 수 있어야 한다
> 2. 표기를 지킨다: **[결정]** 합의한 것 · **[제안]** 아직 합의 전 · **[미정]** 정하지 않은 것. [제안]을 [결정]으로 바꿀 때는 관련 파트와 합의한 뒤 바꾼다
> 3. 다른 파트에 영향을 주는 변경(포트, 내부 API, 컨테이너, 명세)은 그 파트에 알리고 [12장](#12-명세에서-바뀌는-것) · [13장](#13-미정--확인-필요)도 같이 고친다
> 4. 고친 뒤 맨 아래 [변경 기록](#14-변경-기록)에 파트 · 바꾼 곳 · 이유를 한 줄 남긴다
> 5. 비밀값의 실제 값은 적지 않는다(이름과 쓰는 곳만)
>
> 관련 문서: [API 명세](../../docs/API-명세.md) · [AI 명세](../../docs/AI-명세.md) · [BE 설계](../../docs/BE-설계.md) · [CONTRIBUTING](../../docs/CONTRIBUTING.md) · 개발 서버 배포 [`deploy/dev/compose.yml`](../../deploy/dev/compose.yml)

## 목차

1. [전제](#1-전제)
2. [전체 구조](#2-전체-구조)
3. [서버 구성](#3-서버-구성)
4. [미디어 서버 (LiveKit)](#4-미디어-서버-livekit)
5. [도메인 · 네트워크](#5-도메인--네트워크)
6. [저장소 · 권한](#6-저장소--권한)
7. [비밀값 · 설정값](#7-비밀값--설정값)
8. [빌드 · 배포 (CI/CD)](#8-빌드--배포-cicd)
9. [백업](#9-백업)
10. [비용](#10-비용)
11. [작업 순서](#11-작업-순서)
12. [명세에서 바뀌는 것](#12-명세에서-바뀌는-것)
13. [미정 · 확인 필요](#13-미정--확인-필요)
14. [변경 기록](#14-변경-기록)

## 1. 전제

| 항목 | 내용 | 왜 |
|---|---|---|
| 운영 서버 | SSAFY가 준 **Lightsail 1대에 모두 올린다**(4코어 · 15GB · 320GB, Ubuntu 24.04) **[결정]**. BE · AI · DB · FE · 미디어 서버가 모두 이 서버에 있다. SSAFY 계정 서버라 pem 키와 IP만 받는다 | 서버 비용이 0이고, 지금 서비스 규모에는 한 대로 충분하다. 문제가 생기면 그때 나눈다(1.1 모놀리식) |
| 서버 역할 | ① 미디어 서버: WebRTC 전부(음성·영상 중계, 저장, 파일 추출) ② AI: STT · TTS · Jev · LLM(면접) ③ BE: CRUD ④ FE: 클라이언트 **[결정]** | 역할을 나눠 두면 나중에 서버를 분리할 때 경계가 이미 정해져 있다 |
| 미디어 서버 | **운영: LiveKit 셀프 호스팅 · 개발: LiveKit Cloud** **[결정]**(4.0) | 운영: WebRTC 중계 · 녹화를 직접 만들지 않고, 서버 비용 없이 지급 서버에 올리기 위해. 개발: 개발 서버(미니PC)가 이중 NAT 뒤에 있어 바깥에서 미디어 포트로 들어올 수 없기 때문 |
| 예산 | 인프라 $100(외부 API 비용 제외). 서버 비용이 없으므로 S3에만 쓴다. 운영 이미지는 Docker Hub에 둔다(8장) | 서버가 무료라 예산은 저장소와 예비비로 남긴다 |
| 개발 서버 | 미니PC(develop 배포, `deploy/dev/compose.yml`). 운영도 같은 모양(compose 하나)으로 맞춘다 | 개발 서버에서 되던 것이 운영에서도 되도록 환경 차이를 줄인다 |
| MVP에 넣는 것 | 면접방(LiveKit) · TURN · 서버 녹화(LiveKit Egress) · 다시보기 · 모니터링 **[결정]** | TURN: 시연 장소(강의실) 네트워크에서도 면접방이 열려야 한다. 녹화 · 다시보기: 화면 설계(S07-1)의 핵심 기능이다. 모니터링: 문제가 생겼을 때 원인을 알아야 서버 분리 · 확장을 판단할 수 있다 |
| MVP 범위 밖 | SQS · 공시 적재 worker, 공시 파이프라인(Airflow · Spark · MinIO, 로컬 PC에서 고도화 때), LLM 꼬리질문(질문은 면접 전에 만든 5개로 고정) **[결정]** | 공시 파이프라인은 고도화 기능이다. 꼬리질문을 빼면 면접 중 LLM 호출이 없어져 응답 지연과 실패 지점이 줄어든다 |

pem과 IP만 받으므로 우리가 쓸 수 **없는** 것: IAM 역할, SSM, 스냅샷, 플랜(크기) 변경. 방화벽은 서버 안의 `ufw`로 우리가 관리한다(5.2).

- 왜 적어 두나: 이 제약 때문에 아래 결정들이 나왔다. IAM 역할이 없어서 서버에 IAM 키를 두고(6.2), 스냅샷이 없어서 DB 백업을 직접 한다(9장)

### 1.1 설계 근거

**왜 WebRTC를 사용하나요?**

STT/TTS 기능뿐만 아니라 추후 영상 분석, 저장 기능까지 고려하면, WebSocket 방식으로 처음부터 구현하는 것보다 이미 구현된 미디어 서버 위에서 WebRTC를 사용하는 것이 프로젝트 복잡도나 안정성 측면에서 유리하다고 판단했다. 품질 관리나 미디어 인코딩 같은 로직을 처음부터 작성할 필요가 없다는 점을 큰 장점으로 봤다.

**왜 FE에서 BE만 보도록 설계했나요?**

FE가 BE, AI 서버 등 여러 서버를 직접 보게 되면 악성 사용자 입장에서 공격 가능한 지점이 늘어난다고 판단했다. 또 FE가 BE만 보면 주소 관리 등 복잡도 측면에서도 유리하다.

WebRTC는 구조상 시그널링 과정에서 미디어 서버 주소가 노출되므로, 미디어 서버의 보안도 고려해 구현한다.

- 브라우저가 BE 말고 직접 붙는 곳은 **LiveKit 하나뿐**이다. 시그널은 Tunnel(`rtc.hangguet.co.kr`)로, 미디어는 UDP 7882 · TCP 7881로만 받는다(5장)
- 면접방에는 **BE가 발급한 입장 토큰**으로만 들어간다. 토큰은 면접방 하나 · 해당 회원에게만 권한을 주고 유효 시간을 짧게 둔다 **[제안]**
- AI 서버 · DB · Redis는 외부에 열지 않는다. 외부 API 키(Soniox · ElevenLabs · Jev · GMS)는 서버에만 있다

**미디어 서버는 왜 쓰나요?**

WebRTC 기반의 음성·영상 통신 과정을 처음부터 구현하기보다, 이미 구현된 미디어 서버(LiveKit)를 사용하면서 서비스의 비즈니스 로직과 AI 기능 품질 향상에 집중하기로 결정했다.

**AI 서버는 왜 사용하나요?**

초기 면접 질문 생성, 실시간 면접 API(Jev 피드백, Jev 표정 분석, LLM 꼬리질문과 평가), 기업 분석 API 등 다양한 AI 작업을 각각 다른 서버(BE 등)에서 진행하면 유지보수 시 복잡도 측면에서 손해가 있다고 판단했다.

AI 서버가 필요한 기능을 계약된 API 형태로 제공하면, AI 서버의 로직이 바뀌어도 호출하는 서버 입장에서는 고칠 것이 없다. 이것을 이 구조의 큰 장점으로 봤다.

- 계약은 두 형태다. 오래 걸리는 작업(질문 생성 · 채점 · 결과)은 **Redis 큐 작업 메시지**([AI 명세 1.3](../../docs/AI-명세.md)), 면접 중 실시간 처리는 **AI 에이전트가 LiveKit 면접방 안에서** 맡는다. 두 계약 모두 AI 명세에 적는다(12장)
- **DB는 BE만 다룬다** **[결정]**. AI는 DB에 접속하지 않는다(읽기 · 쓰기 모두)
  - 입력: BE가 필요한 데이터를 작업 메시지(Redis `ai:jobs`)와 에이전트 배정 메타데이터(질문 5개 · 채점 기준 포함)에 담아 보낸다
  - 출력: AI 분석 작업자(플랜 · 채점 · 결과 · 녹화 합치기 · 진행 상태)와 AI 에이전트(질문 시작 · 답변)는 **Redis 결과 큐**(`ai:results` **[제안]**)에 넣고, BE가 꺼내 검증한 뒤 DB · Redis 진행 상태에 쓴다
  - 왜: 스키마는 BE의 Flyway(Java)가 관리한다. AI(Python)가 같은 테이블을 직접 읽고 쓰면 마이그레이션 때마다 두 파트가 함께 고쳐야 하고, 면접 상태 규칙(`ANALYZING`일 때만 결과 저장 등)도 두 곳에 생긴다. DB를 BE 한 곳에서만 다루면 AI와 BE 사이 계약은 메시지 형식 하나가 되어 서로 독립적으로 바꿀 수 있다
  - 왜 HTTP 내부 API가 아니라 Redis 결과 큐인가: 분석 작업은 이미 Redis 큐로 비동기 처리하므로 결과도 같은 길로 돌려받는다. AI → BE HTTP 창구가 없으니 내부 API가 바깥에 노출될 걱정(Nginx `/be/` 경로 등)과 내부 인증 키가 필요 없다. 대신 BE에 결과 큐를 꺼내 저장하는 코드가 생긴다

**배포 방식은 왜 모놀리식을 사용하나요?**

현재 서비스가 그렇게 크지 않기 때문이다. 서비스를 배포한 뒤 버벅거림 등 문제가 생기면 원인을 분석해, 지원받은 교보재 AWS 서버를 활용한 MSA 구조로 전환하거나 무거운 서버 구성을 Scale out하는 등으로 대응한다. 문제가 없으면 대규모 기업 분석 작업을 AWS에서 진행한다.

- 나중에 서버를 나누기 쉽도록 지금부터 서비스끼리는 컨테이너 이름(내부 주소)과 환경 변수로만 연결하고, 같은 서버에 있다는 가정(로컬 파일 공유, `localhost` 호출)을 코드에 넣지 않는다 **[제안]**
- 문제를 원인 분석하려면 서비스별 CPU · 메모리 사용량을 볼 수 있어야 하므로 모니터링을 MVP에 넣는다(3.3)

## 2. 전체 구조

```
브라우저
  ├─ https://hangguet.co.kr ─────▶ Cloudflare ─▶ Tunnel ─┐
  ├─ wss://rtc.hangguet.co.kr ───▶ Cloudflare ─▶ Tunnel ─┤ (시그널링)
  ├─ UDP 7882 / TCP 7881 ─────────────────────────────────┼─▶ (미디어, Lightsail 공인 IP로 직접)
  └─ turn.hangguet.co.kr UDP 3478 / TLS 443 ──────────────┼─▶ (TURN: 위 두 포트가 막힌 네트워크용)
                                                          ▼
┌─ Lightsail (SSAFY 지급) ────────────────────────────────────────────────────┐
│  cloudflared ─┬─▶ Nginx ─▶ FE ─▶ BE ─▶ PostgreSQL · Redis                    │
│               ├─▶ LiveKit(7880)                                              │
│               └─▶ Grafana (grafana.hangguet.co.kr, Grafana 로그인)           │
│                                                                              │
│  LiveKit ◀── UDP 7882 · TCP 7881 ── 브라우저(카메라 · 마이크 / 면접관 음성)   │
│     ▲                                                                        │
│     └──▶ AI 에이전트 ─▶ Soniox(STT) · ElevenLabs(TTS) · Jev                   │
│              └─ 질문 시작 · 답변 ─▶ Redis 결과 큐 ─▶ BE                       │
│                                                                              │
│  LiveKit ─▶ Egress(트랙 녹화, 화상만) ─▶ S3 recordings/raw/                  │
│  Redis 큐 ─▶ AI 분석 작업자 ─▶ GMS · ffmpeg(녹화 합치기) ─▶ S3               │
│                   └─ 플랜 · 채점 · 결과 · 진행 상태 ─▶ Redis 결과 큐 ─▶ BE      │
│  Prometheus ◀─ node-exporter · cAdvisor · LiveKit · Egress 지표 ─▶ Grafana    │
│  GitLab 러너(protected) ─▶ Docker Hub에서 이미지 pull ─▶ docker compose up    │
└──────────────────────────────────────────────────────────────────────────────┘
        │ 프로필 사진 · 녹화 · 백업
        ▼
우리 AWS 계정 ($100): S3          Docker Hub: 운영 이미지(비공개 저장소)
```

요청이 흐르는 길:

1. **화면 · CRUD**: 브라우저 → Cloudflare → Tunnel → Nginx → FE → BE → PostgreSQL · Redis. FE는 API를 서버에서만 부르고(`API_BASE_URL`), BE를 내부 네트워크로 바로 부른다
2. **면접방 입장**: 브라우저 → Nginx → FE → BE. BE가 면접 상태를 확인하고 **LiveKit 입장 토큰**을 발급한다(방 = 면접, 참가자 = 회원). AI 에이전트를 그 방에 배정한다. 화상 · 채팅 모두 입장한다. 채팅은 마이크 · 카메라를 켜지 않고 면접관 음성(TTS)만 받는다 **[결정]**
3. **시그널링**: 브라우저 → Cloudflare → Tunnel → LiveKit 7880 (`wss://rtc.hangguet.co.kr`)
4. **미디어**: 브라우저 ⇄ Lightsail 공인 IP UDP 7882(막히면 TCP 7881, 그것도 막히면 TURN: UDP 3478 → TLS 443) ⇄ LiveKit
5. **면접 진행**: LiveKit → AI 에이전트(사용자 음성 구독) → STT → Jev → LiveKit → 브라우저. 질문은 면접 전에 만든 플랜의 5개를 TTS로 읽어 면접관 음성으로 발행한다(면접 중 LLM 호출 없음). 리액션은 LiveKit 데이터 메시지로 브라우저에 보내고, 브라우저가 아바타를 움직인다. 질문을 말하기 시작한 시각과 인식한 답변은 에이전트가 Redis 결과 큐로 보내고 BE가 저장한다. 채팅은 STT 없이 화면이 답변 글을 BE에 보낸다
6. **채점 · 결과**: BE가 필요한 데이터를 담아 Redis 작업 큐에 넣고, AI 분석 작업자가 GMS로 처리해 진행 상태와 결과를 Redis 결과 큐에 넣는다. BE가 꺼내 DB와 Redis 진행 상태에 쓴다. 화면은 2초마다 BE에 상태를 묻는다(지금 명세와 같음)
7. **녹화 · 다시보기(화상만)**: 면접이 시작되면 BE가 Egress 녹화를 시작한다 → Egress가 트랙(사용자 영상 · 음성, 면접관 음성)을 S3 `recordings/raw/`에 바로 올린다 → 면접이 끝나면 AI 분석 작업자가 ffmpeg로 하나의 mp4로 합쳐 `recordings/`에 올리고, Redis 결과 큐로 완료를 알린다(BE가 DB에 기록) → 다시보기(6.4)는 BE가 준 Presigned URL로 브라우저가 S3에서 바로 재생한다(4.3)
8. **모니터링**: Prometheus가 서버 · 컨테이너 · LiveKit · Egress 지표를 모으고, 팀원은 `grafana.hangguet.co.kr`(Grafana 자체 로그인)로 본다(3.3)

외부 API 키(Soniox · ElevenLabs · Jev · GMS)는 모두 서버(AI)에만 있다. 브라우저는 외부 서비스에 직접 붙지 않는다.

AI와 BE는 서로 HTTP로 부르지 않고 Redis 큐(`ai:jobs` 작업, `ai:results` 결과)로만 주고받는다. 결과 큐도 작업 큐처럼 처리 중 목록으로 옮겨 꺼내고, BE는 같은 결과가 두 번 와도 한 번만 저장한다 **[제안]**. 왜: BE가 처리 도중 멈춰도 메시지가 남아 다시 처리할 수 있고, 작업 큐와 같은 방식이라 새로 익힐 것이 없다.

왜 이렇게 나눴나:

- **웹 · 시그널링은 Tunnel, 미디어는 직접**: Tunnel은 서버에 들어오는 포트를 열지 않아도 되고 인증서도 Cloudflare가 관리한다. 하지만 Cloudflare는 UDP 미디어를 중계하지 못하므로 미디어만 서버 IP로 직접 받는다
- **질문은 미리 만든 5개**: 면접 중에는 STT · Jev · TTS만 돌아 응답이 빠르고, LLM 장애가 면접 진행을 막지 않는다
- **녹화는 끝난 뒤 합친다**: 면접 중에는 원본만 저장하고 무거운 작업(합치기)은 면접이 끝난 뒤 큐로 돌려, 면접 중 서버 부담을 줄인다

## 3. 서버 구성

### 3.1 공통

| 항목 | 내용 | 왜 |
|---|---|---|
| 접속 | pem으로 SSH | SSAFY가 pem만 준다 |
| 런타임 | Docker Engine + Compose plugin | 개발 서버와 같은 방식으로 띄운다 |
| compose | 프로젝트 `a301-prod`, 파일 `deploy/prod/compose.yml`, 컨테이너 이름 `a301-prod-*` **[제안]** | 개발 서버(`a301-dev-*`)와 이름이 겹치지 않고 어느 환경인지 바로 보인다 |
| 메모리 | 컨테이너마다 `mem_limit` **[제안]**. 스왑 4GB(`vm.swappiness=10`) 만들어 둠 | 한 서비스가 메모리를 다 써도 다른 서비스(특히 DB)가 같이 죽지 않게 한다. 스왑은 메모리가 정말 부족할 때만 쓰게 우선순위를 낮췄다 |
| 시간대 | `Asia/Seoul`로 바꿔 둠 | 서버 로그와 매일 돌릴 DB 백업 시각을 한국 시간으로 읽기 위해. 앱은 이미 한국 시간으로 응답하므로 영향 없다 |
| 셋팅 결과 | Ubuntu 24.04.4 · 4코어 · 15GB(처음 사용 약 0.6GB) · 디스크 309GB · 공인 IP `13.209.81.168`. Docker 29.9 + Compose v5.6(공식 저장소, 기본 로그 10MB × 3). 배포 폴더 `/opt/a301`(러너 계정 전용) | 기본 셋팅 기록. 다시 만들 일이 생기면 이 값과 비교한다 |
| 로그 | json-file 10MB × 3(개발 서버와 같음) | 로그가 디스크를 채우지 않게 한다 |
| CPU 버스트 | Lightsail 플랜은 버스트형이다. 이 서버는 Linux $84 플랜(4 vCPU · 16GB · 320GB)이고 **기준치는 vCPU당 40%**다(AWS 문서 [Baseline CPU performance](https://docs.aws.amazon.com/lightsail/latest/userguide/baseline-cpu-performance.html)). 2023-06-29 이전에 만든 서버는 같은 플랜이라도 22.5%인데, 이 서버는 2026-10-21(UTC)에 처음 부팅했다(`/var/log/cloud-init.log` 첫 줄, 11/02 확인). 평균 CPU가 40%를 넘는 동안 크레딧을 쓰고, 다 쓰면 40%로 묶여 서버 전체가 느려진다. 크레딧은 24시간 동안 모을 수 있는 양까지만 쌓인다 | 동시 면접 수를 정할 때 이 기준치가 상한이 된다. 크레딧 잔량은 SSAFY 계정 콘솔에서만 보이므로, 서버에서는 CPU `steal` 증가로 간접 확인한다 |

### 3.2 컨테이너

실제 구성은 [`deploy/prod/compose.yml`](../../deploy/prod/compose.yml)이다(10/26 작성, 개발 서버 compose와 같은 이름 · 같은 환경 변수).

| 컨테이너 | 역할 | 외부 노출 | 메모리 상한 **[제안]** |
|---|---|---|---|
| `a301-prod-cloudflared` | Cloudflare Tunnel(`hangguet.co.kr`, `rtc.hangguet.co.kr`, `grafana.hangguet.co.kr`) | 밖으로 나가는 연결만 | 64m |
| `a301-prod-nginx` | `/` → FE, `/be/` → BE, `/admin/` → 관리 페이지(개발 서버와 같은 경로). 관리 페이지가 `/be/api/v1`을 부르므로 `/be/`는 연다. Swagger는 **공개하지 않는다** **[결정]**: BE에서 끄고(`SPRINGDOC_*_ENABLED=false`) Nginx에서도 `/be/docs` · `/be/swagger-ui` · `/be/v3/api-docs`를 404로 막는다. 왜: 운영 API 구조를 바깥에 드러낼 이유가 없고, 확인은 개발 서버 Swagger로 한다 | 없음 | 64m |
| `a301-prod-admin` | 관리 페이지 정적 파일 | 없음 | 64m |
| `a301-prod-ai` | AI 상태 확인(`/health`)만 하는 HTTP. 개발 서버와 같다 | 없음 | 256m |
| `a301-prod-fe` | Next standalone. `livekit-client`로 면접방 접속. `API_BASE_URL=http://a301-prod-be:8080/api/v1` | 없음 | 512m |
| `a301-prod-be` | CRUD + LiveKit 입장 토큰 발급 + 녹화 시작 · 종료 요청 + 큐 작업 등록 + AI 결과 큐 처리(저장). DB를 다루는 유일한 서비스. `-Xmx512m` · `-XX:+ExitOnOutOfMemoryError`. 상한은 힙을 다 쓴 최악값(약 1.06GB, 로컬 실측)에 여유를 둔 값이다 | 없음 | 1280m |
| `a301-prod-livekit` | 미디어 서버 + TURN(4장) | UDP 7882, TCP 7881, UDP 3478, TCP 443 | 512m |
| `a301-prod-egress` | 서버 녹화(4.3). 트랙 녹화라 인코딩을 하지 않는다 | 없음 | 1g **[제안]** 실측 |
| `a301-prod-ai-agent` | 면접방 참가자. STT → Jev, 질문 TTS, 리액션 데이터 메시지, 질문 시작 · 답변을 Redis 결과 큐로 전달. 질문 5개 · 채점 기준은 배정 메타데이터로 받는다. 면접 1건마다 처리 프로세스가 하나 생겨 면접이 끝날 때(5.8에서 BE가 방을 지울 때)까지 떠 있다 | 없음 | 4g **[제안]**: 면접 1건 약 150~200MB(추정)로 동시 약 20건. 서버에서 다른 상한을 빼고 남는 만큼이다. 실측 후 조정 |
| `a301-prod-ai-analysis` | 기본 작업 큐(`ai:jobs`)의 답변 채점 · 결과 생성(SCORE_ANSWER · EVALUATE). 입력은 작업 메시지로 받고, 진행 상태 · 결과는 Redis 결과 큐로 전달. 에이전트와 같은 이미지를 `python -m app.worker`로 띄운다(개발 `a301-dev-ai-analysis`도 같은 모양, 10/26 추가). 큐를 나누기 전에 `ai:jobs`에 들어간 PLAN · 녹화 합치기도 처리하도록 GMS · S3 값을 모두 받는다. HTTP가 없어 헬스체크는 컨테이너 안에서 Redis 연결로 한다. **같은 큐의 작업자를 늘리지 않는다**: 처리 중 리스트를 작업자끼리 공유해, 늘리면 재시작 때 다른 작업자의 작업까지 되돌려 중복 처리된다 | 없음 | 256m **[제안]** 실측 |
| `a301-prod-ai-plan` | 질문 생성 큐(`ai:jobs:plan`) 전용 작업자(`AI_WORKER_QUEUE=plan`). 사용자가 기다리는 PLAN이 녹화 합치기 · 결과 생성에 밀려 3분 마감을 넘기지 않게 나눈다(AI 명세 1.3) | 없음 | 256m **[제안]** 실측 |
| `a301-prod-ai-recording` | 녹화 합치기 큐(`ai:jobs:recording`) 전용 작업자(`AI_WORKER_QUEUE=recording`). ffmpeg가 실시간 면접과 CPU를 나눠 쓰도록 `cpus: 1`로 제한한다. 로컬 PC에서 15분 녹화 합치기에 CPU 약 9초, 메모리 약 90MB를 썼다 | 없음 | 256m · 1코어 **[제안]** 운영 실측 |
| `a301-prod-postgres` | 메인 DB(PostgreSQL 18) | 없음 | 1g |
| `a301-prod-redis` | 세션 · 리프레시 토큰 · 작업 큐 · 결과 큐. `noeviction`(차면 쓰기가 거절되어 로그인까지 실패하므로 넉넉히) | 없음 | 256m |
| `a301-prod-prometheus` · `grafana` · `cadvisor` · `node-exporter` · `blackbox` · `redis-exporter` · `postgres-exporter` | 모니터링(3.3). 앱 지표 · 상태 확인은 개발 서버와 같은 job 이름을 쓴다 | 없음(Grafana만 Tunnel) | 합계 약 1.9g(cAdvisor 384m · Grafana 768m) |
| `a301-prod-loki` · `alloy` | 로그 수집(3.3). `a301-prod-*` 로그를 7일 보관 | 없음 | 512m · 128m |

모든 컨테이너 상한의 합계는 약 12.2GB(에이전트 4g 포함)다. 나머지 약 2.8GB를 OS · Docker · 러너가 쓴다. 이 서버 한 대로 늘릴 수 있는 동시 면접 수는 메모리로 약 20~30건이 끝이고, CPU(하루 평균 40%) · 녹화(Egress) · AI 작업자(작업을 하나씩 처리)가 그보다 먼저 막을 수 있다. 그 이상은 에이전트 · Egress · 작업자를 다른 서버로 나눠야 한다(1.1). 이미지 빌드는 이 서버에서 하지 않는다(8장).

- 왜 외부 노출을 LiveKit만 하나: 바깥에서 직접 닿는 곳이 적을수록 공격받을 지점이 줄어든다(1.1). 웹은 Tunnel로만 들어온다
- 왜 AI 메모리는 [미정]인가: 에이전트는 면접마다 프로세스가 늘고, 분석 작업자는 라이브러리가 정해지지 않았다. 추측으로 잡으면 강제 종료가 나거나 메모리를 낭비하므로 실측해서 정한다

### 3.3 모니터링 **[결정]**(구성은 **[제안]**)

| 구성 | 보는 것 |
|---|---|
| Prometheus | 지표 수집 · 저장(보존 15일 정도) |
| node-exporter | 서버 CPU · 메모리 · 디스크 · 네트워크 |
| cAdvisor | 컨테이너별 CPU · 메모리(어느 서비스가 무거운지) |
| LiveKit · Egress 내장 지표 | 면접방 · 참가자 수, 패킷 손실, 녹화 상태. `livekit.yaml`의 `prometheus_port`로 내보낸다 |
| redis_exporter · postgres_exporter | Redis 메모리(상한 대비) · 연결 · 오류, PostgreSQL 연결 · 트랜잭션 · 크기 · 잠금(10/27 추가) |
| Grafana | 대시보드. `grafana.hangguet.co.kr`을 Tunnel로 열고 **Grafana 자체 로그인**(아이디 · 비밀번호)으로 막는다 **[결정]** |

- 의도: 서버 한 대에 모든 서비스가 있으므로, 느려졌을 때 "어느 컨테이너 때문인지"를 바로 알아야 한다. 그래야 그 서비스만 떼어 낼지(MSA) 판단할 수 있다(1.1)
- 왜 Grafana 자체 로그인: 팀원이 Cloudflare 계정이나 이메일 인증 없이 아이디 · 비밀번호로 바로 들어갈 수 있다. 대신 로그인 화면이 인터넷에 열리므로 아래를 지킨다 **[제안]**
  - 관리자 비밀번호는 `GRAFANA_ADMIN_PASSWORD`(7장)로 길고 무작위로 둔다. 기본값(`admin/admin`)으로 뜨지 않게 한다
  - 회원가입(`GF_USERS_ALLOW_SIGN_UP=false`)과 익명 접근(`GF_AUTH_ANONYMOUS_ENABLED=false`)을 끈다. 둘 다 Grafana 기본값도 꺼져 있지만 compose에 명시한다
  - 팀원은 관리자 계정을 같이 쓰지 않고 각자 계정(보기 권한)을 만든다. 누가 무엇을 바꿨는지 남는다
  - 로그인 시도 제한(Grafana 기본 기능)을 끄지 않는다
- BE 지표(요청 수 · 응답 시간)는 Spring Actuator에 Prometheus 내보내기를 추가해야 한다(BE 작업, **[미정]**)
- 로그 수집은 **Loki + Alloy + Grafana**로 MVP에 넣는다 **[결정]**(10/26, 처음 안은 `docker logs`). Alloy가 `a301-*` 컨테이너 로그를 Loki에 모으고, 팀원은 Grafana의 로그 대시보드(서비스 선택 · 검색어 · 기간)에서 본다
  - 왜: 팀원이 SSH 없이 로그를 봐야 한다. `docker logs`는 서버 접속이 필요하고 재배포하면 이전 컨테이너 로그가 사라진다. Grafana를 이미 쓰므로 계정 · 화면을 따로 만들 필요가 없다
  - 보관: 개발 3일, 운영 7일 **[결정]**. 운영 로그는 **팀원 전원이 Viewer로 본다** **[결정]**. 조건: 로그에 개인정보(이메일 · 자소서 · 답변 원문 · 토큰)를 남기지 않는다
    - 왜: 6명 모두 이 서비스를 만드는 개발자라 운영 문제를 직접 봐야 빨리 고친다. 무료 Grafana(OSS)는 데이터 소스별 권한이 없어 대시보드를 숨겨도 계정이 있으면 Loki를 조회할 수 있으므로, 일부만 보게 하는 설정은 실제로 막히지 않는다. 실제 사용자가 많아지면 운영 Grafana 계정을 인프라만 갖게 좁힌다
  - 운영도 첫 배포에 넣는다(`deploy/prod/compose.yml`의 `a301-prod-loki` · `a301-prod-alloy`, 대시보드 **A301 운영 서버 로그**). 왜: 첫 배포에서 생기는 문제를 보려면 로그가 필요하다
  - 개발 서버에 먼저 넣었다([`deploy/dev/monitoring`](../../deploy/dev/monitoring/README.md)). 로컬 시험에서 Loki 약 65MB · Alloy 약 50MB. 운영은 같은 모양으로 `deploy/prod/compose.yml`에 넣는다
- 대시보드 구성(10/27): **A301 운영 서버**는 전체 현황 → 서버 → BE · AI → LiveKit · 녹화 → Redis → PostgreSQL → FE → 컨테이너 순서의 줄로 나누고(컨테이너별 상세는 원인을 좁힐 때만 보므로 맨 아래), **A301 운영 서버 로그**는 흐름별 오류 · 전체 로그로 나눈다. 자세한 패널은 [`deploy/prod/README.md`](../../deploy/prod/README.md) 「대시보드」
  - 왜 Redis · PostgreSQL exporter를 넣었나: Redis는 `noeviction`이라 메모리가 차면 쓰기를 거부해 로그인 · 면접이 막히는데, cAdvisor는 컨테이너 메모리만 보여 Redis 상한(192MB) 대비 사용량을 알 수 없다. DB도 HikariCP 풀만으로는 DB 쪽 연결 · 잠금 · 긴 트랜잭션을 볼 수 없다. 둘 다 64MB 상한이다
  - 운영 대시보드에서 FE 브라우저 지표 패널은 뺐다. 운영은 FE 지표를 켜지 않아 늘 비어 있기 때문이다
- 알림(디스크 · 메모리 임계치)은 **[미정]**

## 4. 미디어 서버 (LiveKit)

### 4.0 개발 · 운영 환경 **[결정]**

| 환경 | LiveKit | 브라우저가 붙는 주소 | 서버(BE · AI)가 붙는 주소 |
|---|---|---|---|
| 개발 (develop) | **LiveKit Cloud** | `wss://<프로젝트>.livekit.cloud` | 같은 주소(인터넷으로) |
| 운영 (master) | **셀프 호스팅**(Lightsail, 4.1~4.3) | `wss://rtc.hangguet.co.kr` | `ws://a301-prod-livekit:7880`(내부) |

**왜 개발은 LiveKit Cloud인가**

- WebRTC 미디어는 바깥에서 서버의 IP:포트(UDP 7882 · TCP 7881)로 **직접** 들어와야 한다. Cloudflare Tunnel은 HTTP(WebSocket)만 넘겨 주므로 시그널링만 가능하고 미디어는 못 넘긴다
- 개발 서버(미니PC)는 **이중 NAT**(통신사 공유기 → ipTIME → 미니PC) 뒤에 있다. ipTIME 포트 포워딩은 해 두었지만, 앞 장비(통신사 공유기)의 관리자 계정을 몰라 그쪽 포워딩(또는 DMZ)을 못 한다. 그래서 바깥에서 미디어 포트로 들어올 수 없다
- LiveKit Cloud는 서버 · 포트 · TURN을 모두 제공하므로 BE · AI · FE가 바로 붙어 개발할 수 있다. SSAFY 와이파이(바깥 방향 TCP 80 · 443 · 8080만 허용)에서도 Cloud의 TURN/TLS 443으로 붙는다

**의도**: 코드는 개발과 운영이 같고 **주소와 키만 다르게** 한다. LiveKit Cloud와 셀프 호스팅은 같은 서버 소프트웨어라 SDK · API가 같다. 앞 장비 관리자 계정을 알게 되면 개발도 미니PC 셀프 호스팅으로 바꾼다(미니PC의 LiveKit 컨테이너 · Nginx 블록 · Tunnel 주소 `hangguet-rtc.yobistory.com` · ipTIME 포워딩은 이를 위해 남겨 둔다).

**팀원 규칙** **[결정]**: 아래를 지켜야 개발에서 만든 기능이 운영에서 주소와 키만 바꿔 동작한다.

| 규칙 | 왜 |
|---|---|
| LiveKit 주소 · API 키 · 시크릿은 **환경 변수로만** 받는다. 코드에 넣지 않는다 | 개발(Cloud)과 운영(셀프 호스팅)의 주소가 다르고, 운영은 브라우저용 주소와 서버 내부 주소도 다르다 |
| **LiveKit Cloud에만 있는 기능은 쓰지 않는다**: Cloud 에이전트 호스팅(에이전트는 우리 AI 컨테이너에서 돌린다), Cloud가 제공하는 STT · TTS · LLM 추론, 고급 잡음 제거, Cloud 대시보드 분석, Sandbox 토큰 서버 | 셀프 호스팅에는 없는 기능이라 운영에서 동작하지 않는다. 개발에서 되던 것이 운영에서 안 되는 가장 흔한 원인이다 |
| SDK 버전은 운영 서버 버전(`v1.13.10`)과 맞춘다. 서버 새 버전에만 있는 기능은 운영 서버 버전을 올린 뒤 쓴다 | Cloud는 항상 최신 서버라 개발에서는 되지만, 운영은 버전을 고정한다(8.2) |
| 웹훅을 쓴다면 받는 주소를 환경 변수로 둔다 | Cloud는 인터넷에 공개된 주소로만 웹훅을 보낼 수 있어 개발에서는 BE의 웹훅 주소를 바깥에 열어야 한다. 운영은 같은 서버라 내부 주소로 받는다 |
| 개발에서는 **실제 사용자 음성 · 영상을 쓰지 않는다**(테스트 데이터만) | 개발 미디어는 외부 서비스(LiveKit Cloud)를 거친다. CONTRIBUTING 7장의 실제 사용자 데이터 취급 원칙과 같은 취지 |

**개발에서 미리 확인할 수 없는 것**: 운영의 포트 · TURN/TLS 443 · 인증서(4.2), Egress 자원 사용량(4.3)은 Cloud가 대신 처리하므로 개발에서는 드러나지 않는다. Lightsail을 받으면 운영 서버에서 따로 시험한다(11장). Cloud 무료 구간 한도도 가끔 확인한다.

**확인 결과**: SSAFY 와이파이에서 LiveKit Connection Test 성공(Cloud 서버 v1.13.10, 리전 Japan, TURN 연결, 음성 · 영상 송수신). 접속 문제가 생기면 이 결과와 비교한다.

**로컬 개발용 키**: 개발용 LiveKit Cloud 키는 인프라(해준)에게 요청한다. 채팅이나 레포에 공유하지 않는다.

**Cloud 무료 구간(Build 요금제, 매달 1일 초기화)**: 대략 WebRTC 참가 5,000분 · 에이전트 세션 1,000분 · 트랙 녹화 60분 · 하향 전송 50GB. **한도를 넘으면 요금이 나가는 게 아니라 요청이 실패한다**(다음 달까지 면접방 · 녹화가 막힘). 정확한 값은 Cloud 대시보드의 요금 화면에서 확인한다. 그래서 개발 시험은 **면접 1~2분짜리로 짧게** 하고, 녹화는 동작만 확인한다. 긴 녹화 시험은 운영 셀프 호스팅에서 한다(한도 없음).

### 4.1 구성 **[제안]**

실제 파일은 [`deploy/prod/livekit.yaml`](../../deploy/prod/livekit.yaml)이다. 아래 초안과 달리 인증서는 `/etc/letsencrypt`를 통째로 넣어 `live/` 경로를 그대로 쓰고(4.2), `room.empty_timeout`은 BE가 방을 만들 때 정하므로(BE 설계 5.6) 뺐다.

- **시험 기동(10/26)**: 임시 네트워크에서 이 설정으로 띄워 TURN/TLS 443 시작, STUN으로 공인 IP `13.209.81.168` 확인, Redis 연결, 지표 포트(6789) 응답을 확인했다. Egress(`v1.15.0`)도 같은 Redis · LiveKit에 붙어 `service ready`가 났다. 시험 컨테이너는 바로 지웠다

```yaml
# deploy/prod/livekit.yaml
port: 7880               # 시그널링(WebSocket). Tunnel로만 받는다
rtc:
  tcp_port: 7881         # UDP가 막힌 네트워크용 예비 경로
  udp_port: 7882         # 단일 포트 모드: 모든 미디어를 포트 하나로 받는다
  use_external_ip: true  # Lightsail 공인 IP를 알아내 클라이언트에 알려 준다
turn:
  enabled: true
  domain: turn.hangguet.co.kr
  udp_port: 3478         # TURN/UDP
  tls_port: 443          # TURN/TLS: 방화벽이 엄격한 곳에서도 443은 대개 열려 있다
  cert_file: /certs/fullchain.pem
  key_file: /certs/privkey.pem
redis:
  address: a301-prod-redis:6379   # Egress와 주고받는 데 필요하다
prometheus_port: 6789    # 모니터링 지표(내부 전용)
room:
  empty_timeout: 60      # 빈 방은 60초 뒤 닫는다
# API 키는 파일에 쓰지 않고 환경 변수 LIVEKIT_KEYS="키: 시크릿"으로 넣는다
```

- Docker는 브리지 네트워크 + `7881:7881/tcp`, `7882:7882/udp`, `3478:3478/udp`, `443:443/tcp` 포트 연결로 띄운다. 포트 범위 모드(UDP 50000–60000)로 바꾸면 `network_mode: host`가 필요하다
- AI 에이전트는 내부 주소 `ws://a301-prod-livekit:7880`으로 LiveKit에 등록한다
- `use_external_ip`가 공인 IP를 못 찾으면 `rtc.node_ip`에 Lightsail 공인 IP를 직접 적는다
- 왜 단일 UDP 포트 모드: 포트 범위(1만 개)를 열 필요 없이 포트 하나로 된다. 그래서 Docker 브리지 네트워크 그대로 다른 컨테이너와 같은 방식으로 띄울 수 있다. 1:1 면접 규모에서는 성능 차이가 없다

### 4.2 TURN **[결정]**(구성은 **[제안]**)

UDP 7882와 TCP 7881이 모두 막힌 네트워크(학교 · 회사 와이파이 등)에서도 면접방에 들어오게 한다. 시연 장소인 SSAFY 강의실 네트워크도 여기에 해당할 수 있다.

- LiveKit에 내장된 TURN을 쓴다. UDP 3478(TURN/UDP)과 TCP 443(TURN/TLS)을 연다. 왜: 별도 TURN 서버(coturn 등)를 따로 운영하지 않아도 된다
- TURN/TLS는 Tunnel이나 Cloudflare 프록시로 보낼 수 없다(HTTP가 아니다). 그래서 `turn.hangguet.co.kr`은 Cloudflare DNS에서 **프록시 끔(회색 구름)** 으로 Lightsail IP를 바로 가리킨다
- 인증서는 Let's Encrypt로 받는다. 서버에서 `certbot` + Cloudflare DNS 플러그인(DNS-01)을 쓰면 80번 포트를 열 필요가 없다. 갱신은 cron으로 하고, 갱신 뒤 LiveKit을 다시 띄운다(`--deploy-hook`)
- Cloudflare API 토큰은 `hangguet.co.kr` 영역의 DNS 편집 권한만 준다. 왜: 토큰이 새도 다른 설정은 못 바꾸게 한다
- 서버의 443은 다른 용도로 쓰지 않는다(웹은 Tunnel로 받으므로 비어 있다). 왜 443인가: 엄격한 방화벽도 HTTPS 포트(443)는 거의 열어 두기 때문이다
- **확인 결과**: 인증서는 `/etc/letsencrypt/live/turn.hangguet.co.kr/`에 발급했고 자동 갱신 시험을 통과했다. 갱신 뒤 LiveKit을 재시작하는 스크립트를 `/etc/letsencrypt/renewal-hooks/deploy/restart-livekit.sh`에 두었다. LiveKit 컨테이너에는 `/etc/letsencrypt`를 통째로 읽기 전용으로 넣는다(`live/`의 파일이 `archive/`를 가리키는 링크라 파일 하나만 넣으면 링크가 끊긴다)
- **확인 결과**: 시험용 LiveKit으로 Connection Test를 한 결과 **SSAFY 와이파이(TURN)와 핫스팟 모두 접속 · 음성 · 영상 송수신 성공**. LiveKit TURN의 중계 포트 범위(30000~40000)는 **바깥에 열지 않아도** 동작했다

### 4.3 서버 녹화 · 다시보기 **[결정]**(구성은 **[제안]**)

| 항목 | 내용 | 왜 |
|---|---|---|
| 방식 | **트랙 녹화(Track Egress)**: 사용자 영상 · 음성, 면접관(AI 에이전트) 음성을 인코딩 없이 그대로 저장한다 | 방 전체를 화면처럼 녹화하는 방식(RoomComposite)은 헤드리스 Chrome으로 다시 인코딩해 녹화 1건에 CPU 2~4코어를 쓴다. 4코어 서버 한 대에 다 올린 구조에서는 감당할 수 없다 |
| 저장 | Egress가 S3 `recordings/raw/{면접 id}/`에 바로 올린다. S3 키 · 버킷은 BE가 녹화 요청에 담아 보낸다(`LIVEKIT_EGRESS_S3_*` · `S3_BUCKET` · `AWS_REGION`, IAM `a301-prod-egress`). Egress 설정 파일에는 S3 키를 두지 않는다 **[결정]** | 서버 디스크를 거치지 않아 디스크가 차지 않고, 서버가 죽어도 원본이 남는다. 키를 요청에 담는 것은 개발(LiveKit Cloud)과 같은 방식이라, 코드와 compose는 그대로 두고 키 값만 바꿔 운영에 올릴 수 있다 |
| 합치기 | 면접이 끝나면 AI 분석 작업자가 ffmpeg로 트랙을 하나의 mp4로 합쳐 `recordings/{면접 id}.mp4`에 올리고, Redis 결과 큐로 완료를 알린다(DB 기록은 BE). 원본 트랙 위치는 BE가 녹화를 시작할 때 정해 작업 메시지에 담는다 | 면접 중이 아니라 끝난 뒤 큐 작업으로 하므로 면접 중 CPU를 쓰지 않는다 |
| 시작 · 종료 | 화상 면접만 녹화한다. BE가 면접 시작(5.4) 때 녹화를 시작하고 면접 끝(5.8) 때 멈춘다(LiveKit 서버 API). 채팅 면접은 녹화하지 않는다 | 면접 상태를 아는 BE가 시작 · 종료를 맡아야 상태와 녹화가 어긋나지 않는다. 채팅은 영상이 없다 |
| 다시보기 | 6.4가 합친 mp4의 Presigned URL을 준다. 브라우저가 S3에서 바로 재생한다 | 큰 영상이 우리 서버와 Cloudflare를 거치지 않는다 |
| 면접관 화면 | 면접관 아바타는 브라우저가 그리므로 녹화에는 **면접관 음성만** 들어간다 | 서버에는 면접관 영상이 없다. 화면까지 넣으려면 4.4 |
| 연결 | Egress는 Redis로 LiveKit과 주고받는다(`livekit.yaml`의 `redis`) | LiveKit Egress가 동작하는 방식이다 |

### 4.4 나중에

| 상황 | 필요한 것 |
|---|---|
| 동시 접속이 많을 때 | 포트 범위 모드 + host 네트워크 |
| 녹화에 면접관 화면까지 넣을 때 | 브라우저에서 화면을 합쳐 올리거나 RoomComposite(서버 자원 추가) |

## 5. 도메인 · 네트워크

### 5.1 도메인 **[결정]**

| 주소 | 연결 |
|---|---|
| `hangguet.co.kr` | Cloudflare Tunnel → `http://a301-prod-nginx:80` |
| `rtc.hangguet.co.kr` | Cloudflare Tunnel → `http://a301-prod-livekit:7880`(WebSocket) |
| `grafana.hangguet.co.kr` | Cloudflare Tunnel → `http://a301-prod-grafana:3000` (Grafana 자체 로그인, 3.3) |
| `turn.hangguet.co.kr` | **프록시 끔(회색 구름)** A 레코드 → Lightsail 공인 IP(TURN/TLS는 Cloudflare를 거칠 수 없다) |

- 가비아에서 구매, 네임서버는 Cloudflare로 위임 완료
- 개발 서버 터널과 별도로 `a301-prod` 터널을 만든다. 인증서는 Cloudflare가 관리하고 "Always Use HTTPS"를 켠다
- 미디어(UDP · TCP 미디어 포트)는 Cloudflare를 거치지 않고 Lightsail 공인 IP로 바로 들어온다

**왜 Tunnel인가 (Cloudflare Proxy와 비교)**

| | Tunnel(선택) | Cloudflare Proxy(주황 구름) |
|---|---|---|
| 웹용으로 여는 포트 | 없음 | 443 |
| 원본 서버 인증서 | 필요 없음 | Origin CA 인증서 설치 |
| Cloudflare를 건너뛴 직접 접속 | 원래 막힘(들어오는 포트가 없음) | 따로 막아야 함(Docker `ports:`는 ufw를 우회해 ufw만으로는 안 됨) |
| 개발 서버와 같은 방식 | 같음 | 다름 |
| 무료 플랜 제한(요청 100MB · 응답 대기 100초), TURN/TLS 불가 | 같음 | 같음 |

Tunnel이 할 일이 가장 적고 기본값이 안전하다. 무료 플랜 제한은 파일을 S3로 직접 올리고 긴 작업을 큐 · 폴링으로 처리하는 구조라 걸리지 않는다.

### 5.2 열 포트 **[결정]**

| 포트 | 용도 |
|---|---|
| UDP 7882 | 미디어 |
| TCP 7881 | 미디어 예비 경로 |
| UDP 3478 | TURN/UDP |
| TCP 443 | TURN/TLS |
| TCP 22 | SSH(기존) |

- 방화벽은 서버의 `ufw`로 **우리가 관리한다** **[결정]**. SSAFY 안내에 따르면 ufw는 켜져 있고 22번만 열려 있다. 클라우드 쪽 방화벽은 SSAFY가 따로 막지 않는 것으로 보이나, 열고 나서 **바깥 네트워크에서 실제로 들어오는지** 확인한다
- 여는 순서(SSAFY 안내 6번): SSH 터미널을 2~3개 열어 둔 채로 진행한다. 왜: 규칙을 잘못 넣어 SSH가 끊겨도 열린 터미널로 되돌릴 수 있다

```bash
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw allow 3478/udp
sudo ufw allow 443/tcp
sudo ufw status numbered
```

- **주의: Docker가 연 포트는 ufw를 거치지 않는다.** compose의 `ports:`로 연 포트는 Docker가 iptables에 직접 규칙을 넣어 ufw 설정과 상관없이 바깥에 열린다. 그래서
  - DB · Redis · BE 등은 `ports:`를 **쓰지 않거나** 헬스 체크용이면 `127.0.0.1:포트`로만 연다(개발 서버 compose와 같은 방식)
  - 바깥에 열리는 `ports:`는 LiveKit의 7881/tcp · 7882/udp · 3478/udp · 443/tcp뿐이다. ufw 규칙은 이 포트들을 기록으로 남기는 의미이고, LiveKit을 `network_mode: host`로 바꾸면 ufw 규칙이 실제로 적용된다
  - 배포 뒤 `sudo ss -tulpn`으로 바깥 주소(`0.0.0.0` · `[::]`)에 열린 포트가 22 · 443 · 3478 · 7881 · 7882뿐인지 확인한다
- 그 밖의 포트(80 · 7880 · 5432 · 6379 · 3000 · 9090 등)는 열지 않는다. 웹 · 시그널링 · Grafana는 Tunnel로만 받는다
- **SSAFY 강의실 네트워크에서 접속 테스트**를 한다. UDP 7882 → TCP 7881 → TURN(UDP 3478 → TLS 443) 순서로 넘어가는지 확인한다. LiveKit 연결 테스트 페이지(`livekit-cli` 또는 공식 Connection Test)로 어떤 경로로 붙었는지 볼 수 있다
- **확인 결과(실측)**
  - SSAFY 와이파이는 **바깥으로 나가는 TCP를 80 · 443 · 8080만 허용**한다(3478 · 5349 · 7880 · 7881 · 8443은 막힘). 그래서 강의실에서는 TCP 7881이 안 되고 **TURN/TLS 443이 사실상 유일한 길**이다
  - Lightsail 쪽: SSAFY 와이파이에서 443 접속 성공, 핫스팟에서 443 · 7881 접속 성공 → **Lightsail 방화벽(SSAFY 관리)도 이 포트들을 열어 두었다**. UDP는 LiveKit Connection Test로 확인했다(4.2)

## 6. 저장소 · 권한

### 6.1 S3 · Docker Hub

| 리소스 | 내용 | 왜 |
|---|---|---|
| S3 버킷 하나 (우리 AWS 계정) | 접두사 `profile/` · `recordings/raw/`(트랙 원본) · `recordings/`(합친 mp4) · `backup/`. Block Public Access 켬. 브라우저 업로드 · 재생은 Presigned URL. 버킷 이름 `hanggeut-a301-prod`(서울, 글로벌 네임스페이스) **[결정]** | 버킷 하나에 접두사로 나누면 권한을 접두사 단위로 줄 수 있다. 공개를 막고 Presigned URL로만 주면 남의 파일을 볼 수 없다 |
| Docker Hub (운영 이미지) | **비공개 저장소 `hanggeut/a301`**에 서비스를 태그로 구분한다: `be-<커밋 SHA>` · `fe-<커밋 SHA>` · `ai-<커밋 SHA>` **[결정]**. 토큰은 push용(Read & Write, `a301-ci-push`)과 pull용(Read-only, `a301-prod-pull`) 두 개 | 무료 플랜은 비공개 저장소가 1개라 태그로 나눈다. 공개 저장소는 쓰지 않는다(이미지 안에 코드가 그대로 들어 있다). 토큰을 나눠 운영 서버의 토큰이 새도 이미지를 바꿔치기할 수 없게 한다 |

녹화 원본은 Egress가, 합친 영상은 AI 분석 작업자가 S3에 올린다(4.3). 채점에 쓸 답변별 음성을 녹화 원본에서 잘라 쓸지 따로 저장할지는 12장에서 정한다.

**운영 버킷 설정(10/26 생성)**

| 항목 | 값 | 왜 |
|---|---|---|
| 기본 | ACL 비활성화(버킷 소유자 적용), 모든 퍼블릭 액세스 차단, 버전 관리 끔, SSE-S3 | 권한을 정책 한 곳에서만 다루고, 공개 설정 실수로 파일이 열리지 않게 한다 |
| CORS | 출처 `https://hangguet.co.kr`, 메서드 `GET` · `PUT` · `HEAD`, 헤더 `content-type`, 노출 `ETag` | 브라우저가 Presigned URL로 S3에 직접 `PUT`하고, BE가 `Content-Type`을 서명에 넣기 때문에 사전 요청(preflight)이 통과해야 한다. 다른 출처 · 메서드는 막는다 |
| 버킷 정책 | `aws:SecureTransport` = false면 모두 거부(HTTPS만) | 키나 Presigned URL이 평문 HTTP로 오가지 않게 한다 |
| 수명 주기 | `abort-incomplete-multipart`: 완료되지 않은 멀티파트 업로드 7일 뒤 삭제. 객체 자체는 지우지 않는다 | 녹화 업로드가 중간에 끊기면 보이지 않는 조각이 남아 요금이 나온다. 녹화 · 백업 보관 기간은 아직 **[미정]**(13장) |

- 확인: 밖에서 리전(`ap-northeast-2`), 익명 목록 · 읽기 거부, `hangguet.co.kr`의 `PUT` · `GET` 사전 요청 허용과 다른 출처 · `DELETE` · `http://` 출처 거부를 확인했다. 정책 · 수명 주기는 밖에서 확인할 수 없어 콘솔 화면으로만 확인했다
- 개발은 별도 버킷 `a301-livekit-recordings-dev`와 IAM 사용자 `livekit-egress-dev`(녹화) · `a301-dev-app`(앱)을 쓴다(`deploy/dev/compose.yml`, 6.2). 왜: 개발에서는 LiveKit Cloud 서버가 S3에 직접 올리므로 운영 버킷의 IP 조건(6.2)에 막히고, 개발 키가 새도 운영 파일에 닿지 않게 한다

### 6.2 IAM **[결정]**(IP 조건은 **[제안]**)

IAM 역할을 못 쓰므로 IAM 사용자 키를 서버에 둔다. 키마다 권한을 최소로 하고, 버킷 정책에 `aws:SourceIp` = Lightsail 공인 IP 조건을 걸어 키가 새도 다른 곳에서는 못 쓰게 한다.

- IP 조건은 서버가 직접 보내는 요청(`s3:authType` = `REST-HEADER`)에만 건다 **[제안]**. 왜: Presigned URL 요청(`REST-QUERY-STRING`)은 사용자 브라우저 IP에서 오므로, 모든 요청에 걸면 프로필 업로드와 다시보기 재생이 막힌다. Presigned URL은 유효 시간(업로드 10분 · 다운로드 1시간)으로 제한한다

**만든 사용자(10/26)** **[결정]**: 개발과 운영은 같은 역할 · 같은 정책 모양으로 두고 버킷과 키 값만 다르다. 콘솔 접근 없이 액세스 키만 만들었다.

| 역할 | 운영 사용자 · 정책 | 개발 사용자 · 정책 | 변수 이름(운영 `prod/*`, 개발 `dev/*`) | 쓰는 곳 |
|---|---|---|---|---|
| 녹화 | `a301-prod-egress` · `a301-prod-egress-s3` | `livekit-egress-dev` | `LIVEKIT_EGRESS_S3_ACCESS_KEY` · `LIVEKIT_EGRESS_S3_SECRET` | BE가 녹화 요청에 담아 Egress에 넘김(4.3) |
| 앱 | `a301-prod-app` · `a301-prod-app-s3` | `a301-dev-app` · `a301-dev-app-s3` | `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` | BE 프로필 사진(Presigned URL), AI 분석 작업자 녹화 합치기(`recordings/raw/` 읽기 · 합친 mp4 쓰기), 백업 스크립트 |

| 정책 | 허용 |
|---|---|
| 녹화 | `recordings/*`에 `PutObject` · `GetObject` · `AbortMultipartUpload` · `ListMultipartUploadParts`, 버킷에 `GetBucketLocation` |
| 앱 | `profile/*`에 `PutObject` · `GetObject` · `DeleteObject`. `recordings/*` · `backup/*`에 `PutObject` · `GetObject` · `AbortMultipartUpload` · `ListMultipartUploadParts`. 버킷에 `ListBucket` · `GetBucketLocation` |

- 왜 키를 나누나: 한 키가 새도 피해 범위가 그 키의 권한으로 한정된다. 녹화 키는 프로필 · 백업에 닿지 않는다
- 왜 녹화 정책이 개발과 같은가: 개발에서 이미 동작하는 정책을 버킷만 바꿔 옮겼다. 좁히면(예: `recordings/raw/` 쓰기만) 운영에서만 실패할 수 있어 개발과 다르게 두지 않는다
- 왜 앱에 `ListBucket`을 주나: 없으면 없는 파일을 확인할 때 S3가 404 대신 403을 돌려 BE(`S3FileStorage.exists`)가 오류로 처리한다
- 앱 키 이름은 AWS SDK 기본 공급자가 읽는 이름이다. BE 코드는 자격 증명을 따로 설정하지 않는다
- IP 조건은 첫 운영 배포에서 녹화 · 프로필 업로드를 확인한 뒤 버킷 정책에 넣는다 **[제안]**. 왜: 처음부터 넣으면 업로드 실패가 키 문제인지 IP 조건 문제인지 가려내기 어렵다. 넣을 정책(기존 HTTPS 정책에 문장 추가, `<계정 ID>`는 콘솔에서 확인)

```json
{
  "Sid": "DenyServerKeysOutsideLightsail",
  "Effect": "Deny",
  "Principal": { "AWS": ["arn:aws:iam::<계정 ID>:user/a301-prod-app", "arn:aws:iam::<계정 ID>:user/a301-prod-egress"] },
  "Action": "s3:*",
  "Resource": ["arn:aws:s3:::hanggeut-a301-prod", "arn:aws:s3:::hanggeut-a301-prod/*"],
  "Condition": {
    "StringEquals": { "s3:authType": "REST-HEADER" },
    "NotIpAddress": { "aws:SourceIp": "13.209.81.168/32" }
  }
}
```

Docker Hub는 액세스 토큰을 권한별로 나눈다 **[제안]**: push용(Read & Write)은 이미지 빌드 작업에만, pull용(Read-only)은 Lightsail 배포 작업에만 쓴다. 왜: 운영 서버에 있는 토큰이 새도 이미지를 바꿔치기할 수 없다.

## 7. 비밀값 · 설정값

GitLab CI/CD Variables. 비밀값은 Protected · Masked, 환경 범위 `prod/*`. 개발 서버와 **다른 값**을 쓴다 **[결정]**. 왜: 개발 서버 값이 새도 운영에는 영향이 없고, Protected라 보호 브랜치(master) 파이프라인에서만 읽힌다.

**예외: 개발과 같은 값(범위 All)** **[결정]**: 관리자 계정(`ADMIN_LOGIN_ID` · `ADMIN_PASSWORD`), `GRAFANA_ADMIN_PASSWORD`, 외부 API 키(`SONIOX_API_KEY` · `ELEVENLABS_API_KEY` · `JEV_API_KEY` · `LLM_API_KEY`). 모두 Protected라 보호 브랜치 파이프라인에서만 읽힌다.

- 왜: 관리자 · Grafana는 팀이 한 계정으로 두 환경을 같이 관리한다. 외부 API 키는 서비스마다 키를 하나로 쓴다(GMS처럼 더 받을 수 없는 키도 있다)
- 대가: 개발 쪽에서 값이 새면 운영도 같이 바꿔야 한다. 외부 API는 개발 사용량과 운영이 한도를 나눠 쓴다

| 이름 | 비밀 | 쓰는 곳 |
|---|---|---|
| `DB_PASSWORD` | O | postgres, BE(AI는 DB에 접속하지 않는다). DB 볼륨을 처음 만들 때만 적용되므로 첫 배포 전에 확정한다 |
| `JWT_SECRET` | O | BE(HS256, 32바이트 이상) |
| `INQUIRY_ENCRYPTION_KEY` | O | BE 문의 제목 · 본문 암호화(AES-256-GCM, Base64 32바이트). 개발과 다른 값. **바꾸거나 잃으면 저장된 문의를 풀 수 없으므로** 비밀번호 관리자에 따로 보관한다 |
| `ADMIN_LOGIN_ID` · `ADMIN_PASSWORD` | O(아이디는 기동 로그에 찍혀 Masked 안 함) | BE 관리 페이지 계정. 처음 기동할 때 계정이 없으면 만든다. 범위 All(위 예외) |
| `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET` | O | livekit, BE(입장 토큰 서명), AI 에이전트 |
| `SONIOX_API_KEY` | O | AI 에이전트. STT 실행 필수이며 브라우저에 전달하지 않는다 |
| `ELEVENLABS_API_KEY` | O | AI 에이전트(질문 음성). 없으면 질문 글로만 진행한다. 범위 All(위 예외) |
| `JEV_API_KEY` | O | AI 에이전트(답변 리액션). 없으면 리액션 없이 진행한다. 범위 All(위 예외) |
| `LLM_API_KEY` | O | AI(GMS). 이름은 공시 파이프라인([`company-pipeline/pipeline/README.md`](../../company-pipeline/pipeline/README.md))과 같게 한다 |
| `CLOUDFLARE_TUNNEL_TOKEN` | O | cloudflared |
| Cloudflare DNS API 토큰 | O | certbot(TURN 인증서, DNS 편집 권한만). 서버에 파일로 둔다(권한 600) |
| `GRAFANA_ADMIN_PASSWORD` | O | Grafana(개발 · 운영 같은 이름, 범위 All). Grafana 볼륨을 처음 만들 때만 적용된다 |
| `LIVEKIT_EGRESS_S3_ACCESS_KEY` · `LIVEKIT_EGRESS_S3_SECRET` | O | BE(녹화 요청에 담아 Egress에 넘김). IAM `a301-prod-egress`(6.2) |
| `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` | O | BE(프로필 사진), AI 분석 작업자(녹화 합치기) · 백업 스크립트. IAM `a301-prod-app`(6.2) |
| `DOCKERHUB_PUSH_TOKEN` | O | 이미지 빌드 작업(미니PC 러너)만. 이 작업에도 `prod/` 환경 이름을 붙여야 읽힌다(8.1) |
| `DOCKERHUB_PULL_TOKEN` | O | Lightsail 배포 작업만 |
| 계정 `hanggeut` · 저장소 `hanggeut/a301` | X | 빌드 · 배포 작업. 비밀이 아니라 GitLab 변수가 아니라 `.gitlab-ci.yml`에 적는다 |
| `LLM_CHAT_URL` · `LLM_MODEL` | X | AI 분석 작업자. compose에 적는다(개발 · 운영 같은 값, `gpt-4.1-mini`는 AI에 등록된 모델) |
| `SONIOX_STT_MODEL` | X | AI 에이전트. 현재 기본값 `stt-rt-v5` |
| `LIVEKIT_URL`(서버 내부 주소 `ws://a301-prod-livekit:7880`) · `LIVEKIT_PUBLIC_URL`(브라우저에 알려 줄 주소 `wss://rtc.hangguet.co.kr`) | X | AI 에이전트 · BE. 이름은 LiveKit SDK가 기본으로 읽는 이름에 맞춘다 |
| `AWS_REGION` · `S3_BUCKET` | X | compose |

개발 서버(범위 `dev/*`)는 LiveKit Cloud 프로젝트의 값을 쓴다(4.0). 이름은 운영과 같게 두고 값만 다르게 한다. 왜: 코드와 compose가 환경에 상관없이 같은 이름을 읽는다.

| 이름 (dev) | 비밀 | 값 |
|---|---|---|
| `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET` | O | LiveKit Cloud 프로젝트에서 발급한 키 |
| `SONIOX_API_KEY` | O | `dev/*` 범위에서 `dev/ai-agent`에 전달. 없으면 에이전트 배포 잡이 실패한다 |
| `LIVEKIT_URL` · `LIVEKIT_PUBLIC_URL` | X | `wss://a301-dev-gdbmpfm5.livekit.cloud` (브라우저 · 서버 모두 이 주소). 비밀이 아니라 `deploy/dev/compose.yml`에 적는다 |

## 8. 빌드 · 배포 (CI/CD)

### 8.1 흐름 **[결정]**

```
develop → Release MR → master
→ prod-build (자동, yobi 미니PC 배포 러너 a301-mock-deploy) be · fe · ai · admin 이미지 빌드 → Docker Hub push (태그: <서비스>-<커밋 짧은 SHA>) → 미니PC에서 지움
→ prod-deploy (▶ 버튼, Lightsail 러너 a301-prod) deploy/prod/deploy.sh: Docker Hub 로그인(pull 토큰) → 파일 복사 → 백업 준비 → pull → up -d → 상태 확인 → 이미지 정리
```

구현: `.gitlab-ci.yml`의 「운영 서버」, [`deploy/prod/deploy.sh`](../../deploy/prod/deploy.sh). 하는 일 · 롤백은 [`deploy/prod/README.md`](../../deploy/prod/README.md)의 「배포」(10/26 작성, 아직 실행 전).

| 결정 | 왜 |
|---|---|
| **운영 서버만 Docker Hub를 쓴다** **[결정]**. 개발 서버(develop → 미니PC)는 지금처럼 미니PC 러너가 그 자리에서 빌드해 띄운다(`deploy/dev/compose.yml`의 `build`) | 개발 서버는 빌드하는 곳과 도는 곳이 같아 레지스트리를 거칠 필요가 없다. 운영 서버는 다른 곳이라 이미지를 받아 와야 한다 |
| SSAFY GitLab은 Container Registry가 꺼져 있어 외부 레지스트리(Docker Hub)를 쓴다 | GitLab 레지스트리를 쓸 수 없다 |
| Docker Hub 로그인은 **작업마다 임시 폴더**(`DOCKER_CONFIG=$(mktemp -d)`)에서 하고, 작업이 끝나면 로그아웃하고 지운다 | 로그인 정보가 서버(`~/.docker/config.json`)에 암호화되지 않은 채 남지 않게 한다 |
| 이미지 빌드 작업에 `environment: { name: prod/build, action: prepare }`를 붙인다 **[결정]** | push 토큰 범위가 `prod/*`라 이 이름이 있어야 읽힌다. develop 파이프라인에서는 push 토큰이 보이지 않는다 |
| 운영 이미지는 **yobi 미니PC 배포 러너**(`a301-mock-deploy`)에서 빌드한다 **[결정]**. 개발 서버 배포 잡과 같은 `resource_group`(`dev-deploy`)이고, push한 이미지는 미니PC에서 지운다 | 개발 이미지를 이미 여기서 빌드해 빌드 캐시를 같이 쓰고, Docker Hub push도 시험했다. 데일밴드 러너는 작업이 컨테이너 안에서 돌아 Docker를 쓸 수 없다. 같은 그룹이라 미니PC에서 빌드가 겹치지 않는다 |
| 운영 서버에서는 빌드하지 않는다 | Gradle · Next 빌드가 서비스 메모리를 잡아먹어 서비스가 죽을 수 있다 |
| 같은 이미지를 환경만 바꿔 띄우므로 이미지에 환경별 값을 넣지 않는다. FE가 브라우저에 알려 줄 값(LiveKit 주소 등)도 빌드 때 박는 `NEXT_PUBLIC_*` 대신 실행 시점 값(BE 응답이나 서버 환경 변수)으로 넘긴다 **[제안]** | 값을 빌드 때 넣으면 환경마다 이미지를 다시 만들어야 하고, 같은 이미지로 롤백할 수 없다 |
| Lightsail에 **protected** GitLab 러너(shell executor)를 둔다. master 파이프라인만 실행한다 | 아무 브랜치에서나 운영 서버 명령이 돌면 안 된다. 러너가 GitLab에 먼저 접속하므로 포트를 열 필요가 없다 |
| 배포 작업은 `resource_group`(`prod-deploy`)으로 한 번에 하나만, 헬스 체크는 루프백 포트로 한다 **[결정]** | 배포가 겹치면 컨테이너 상태가 꼬인다. 헬스 체크 포트는 바깥에 열지 않는다 |
| master 병합 시 **이미지 빌드는 자동, 운영 배포는 ▶ 버튼** **[결정]**(처음 안은 자동 배포) | 배포하면 에이전트 · LiveKit이 다시 떠 진행 중인 면접이 끊길 수 있어 시점을 사람이 고른다. 이미지를 미리 만들어 두어 버튼을 누르면 빨리 끝나고, 실패하면 배포만 다시 시도하기 쉽다. 안정되면 규칙 한 줄로 자동으로 바꿀 수 있다 |
| 배포 파일은 `/opt/a301/prod`로 복사해 그 자리에서 compose를 실행한다. 설정 파일이 바뀐 서비스만 다시 시작한다 | 설정 파일 경로가 체크아웃 위치와 관계없이 같다. 파일 하나를 붙인 컨테이너는 파일이 바뀌어도 compose가 다시 만들지 않는다. LiveKit을 매번 다시 시작하면 면접이 끊긴다 |

### 8.2 이미지 정리 **[결정]**

운영 서버는 배포 작업 끝에서 서비스(태그 접두사)마다 최신 3개만 남긴다. 미니PC도 push 뒤 같은 방식으로 정리한다. 왜: 배포할 때마다 이미지가 쌓여 디스크가 찬다. 3개를 남기면 바로 전 버전으로 다시 받지 않고 되돌릴 수 있다.

```bash
# 저장소 하나에 서비스를 태그 접두사(be-/fe-/ai-)로 나누므로 접두사마다 최신 3개만 남긴다.
# docker image ls는 만든 시각이 최신인 것부터 보여 준다. 돌고 있는 컨테이너의 이미지는 docker rmi가 거부해 남는다.
for svc in be fe ai; do
  docker image ls hanggeut/a301 --format '{{.Tag}} {{.ID}}' \
    | awk -v p="$svc-" 'index($1, p) == 1 && !seen[$2]++ { print $2 }' \
    | tail -n +4 | xargs -r docker rmi || true
done
docker image prune -f
```

Docker Hub에는 ECR 같은 자동 정리 정책이 없다. 서비스마다 최근 10개 정도만 남기고 오래된 태그는 Docker Hub API나 화면에서 지운다(주기 **[미정]**).

LiveKit · Egress · PostgreSQL · Redis · cloudflared · Prometheus · Grafana · cAdvisor · node-exporter는 공식 이미지를 버전 고정으로 쓴다. 왜: `latest`를 쓰면 다시 배포할 때 모르는 사이 버전이 바뀌어 동작이 달라질 수 있다.

### 8.3 롤백 **[제안]**

- master에서 Run pipeline에 `IMAGE_TAG=<이전 커밋 SHA>`를 넘겨 배포 작업만 다시 돌린다
- BE는 기동할 때 Flyway 마이그레이션을 적용하므로 DB는 되돌아가지 않는다. 마이그레이션은 이전 버전 코드와도 맞게(추가 먼저, 삭제는 나중에) 만든다. 왜: 그래야 이미지만 되돌려도 이전 코드가 새 DB에서 동작한다

## 9. 백업

스냅샷을 쓸 수 없으므로 **DB 백업을 1단계에 넣는다** **[제안]**. 왜: 서버가 망가지면 DB를 되살릴 방법이 이것뿐이다.

- 매일 `pg_dump` → S3 `backup/`. 보관 기간 **[미정]**
- 방식 **[결정]**: 서버 cron(러너 계정, 매일 04:30 한국 시간)이 [`deploy/prod/backup.sh`](../../deploy/prod/backup.sh)를 실행한다. custom 형식 덤프를 `/opt/a301/backup/`에 만들고(서버에는 7일만 남김) aws-cli 컨테이너로 S3에 올린다. 업로드가 실패해도 서버 덤프는 남긴다
  - S3 키는 배포 작업이 GitLab 변수로 `/opt/a301/backup.env`(권한 600)에 써 둔다. 왜: 키 원본을 GitLab 한 곳에만 두고, 키를 바꾸면 다음 배포 때 서버에도 반영된다
  - 스크립트는 배포 작업이 `/opt/a301/backup.sh`로 복사한다. DB 컨테이너가 없으면 건너뛴다(첫 배포 전에도 cron이 실패로 남지 않음)
  - 서버에 cron과 스크립트를 넣어 두었다(10/26)
- 복원을 실제로 한 번 해 본다([CONTRIBUTING 6.4](../../docs/CONTRIBUTING.md#64-infra)). 왜: 복원해 보지 않은 백업은 쓸 수 있는지 모른다

## 10. 비용

| 항목 | 금액(대략) |
|---|---|
| Lightsail · 트래픽 | 0 (SSAFY 부담) |
| S3 · 전송 | 월 몇 달러 |
| Docker Hub | 0 (무료 플랜, 비공개 저장소 1개) |
| 예비비 | 대부분 남음. 고도화 때 Spark 다중 노드 측정 등에 쓴다 |

AWS Budgets 알림 설정 완료 **[결정]**.

## 11. 작업 순서

### 준비

- [x] pem · IP 받기, Docker 설치, 스왑, 시간대
- [x] Lightsail 플랜의 CPU 기준치 확인(vCPU당 40%, 3.1)
- [x] 포트 열기(UDP 7882 · 3478, TCP 7881 · 443), 바깥 네트워크와 SSAFY 와이파이에서 확인
- [x] Cloudflare `a301-prod` 터널(`hangguet.co.kr`, `rtc.hangguet.co.kr`, `grafana.hangguet.co.kr`), `turn.hangguet.co.kr` DNS(프록시 끔), Always Use HTTPS
- [x] TURN 인증서: certbot + Cloudflare DNS 플러그인 발급, 자동 갱신 · LiveKit 재시작 hook
- [x] 시험용 LiveKit으로 TURN · UDP 접속 확인(SSAFY 와이파이 · 핫스팟)
- [x] 시험용 컨테이너(`a301-prod-livekit`, `cloudflared-try`) · 네트워크(`a301-try`) · `~/livekit-try` 정리. **정식 이름으로 띄운 시험 컨테이너가 남으면 CI 배포와 충돌한다**
- [x] Docker Hub 비공개 저장소(`hanggeut/a301`) · push/pull 토큰 · GitLab 변수. 미니PC push, Lightsail pull 성공, pull 토큰으로 push가 막히는 것(`insufficient scopes`)까지 확인
- [x] S3 버킷 `hanggeut-a301-prod`: 퍼블릭 차단 · CORS · HTTPS 정책 · 수명 주기(6.1)
- [x] IAM 사용자 · 키 `a301-prod-egress` · `a301-prod-app`, 개발 앱 키 `a301-dev-app`, GitLab 변수 등록(6.2)
- [ ] 버킷 정책의 IP 조건: 첫 운영 배포에서 녹화 · 프로필 업로드를 확인한 뒤(6.2)
- [x] Lightsail에 protected 러너 등록(`a301-prod`, shell)
- [x] 러너 토큰 재발급: 등록 확인 출력(`gitlab-runner list`)에 토큰이 찍혀 공유돼, 러너를 지우고 새로 등록했다
- [x] 운영 배포 파일 [`deploy/prod/`](../../deploy/prod/README.md): `compose.yml` · `livekit.yaml` · Egress 설정(compose의 `EGRESS_CONFIG_BODY`) · `nginx.conf` · `prometheus.yml` · Grafana 설정 · `backup.sh`. 서버에서 compose · Nginx · Prometheus 설정 검사와 LiveKit · Egress 시험 기동까지 함
- [x] 서버 준비(10/26): 공개 이미지 미리 받기, 백업 스크립트 · cron, 시험 이미지 정리
- [x] Cloudflare 터널의 호스트 이름이 컨테이너 이름을 가리키는지 확인: `hangguet.co.kr` → `http://a301-prod-nginx:80`, `rtc.hangguet.co.kr` → `http://a301-prod-livekit:7880`, `grafana.hangguet.co.kr` → `http://a301-prod-grafana:3000`(10/27 대시보드에서 확인)
- [x] CI 작업 작성: `prod-build`(자동) · `prod-deploy`(▶ 버튼, `deploy/prod/deploy.sh`), `workflow`에 master push 허용(8.1). **아직 실행 전**: 첫 Release MR에서 확인한다
- [x] 운영 BE에 `INQUIRY_ENCRYPTION_KEY` 추가(compose · GitLab 변수)
- [ ] 러너 토큰(`a301-prod`): 10/26 확인 작업 중 출력에 토큰이 남았으나 다시 받지 않기로 함. 노출 범위는 작업 대화 기록이고, 러너가 이상하게 작업을 받거나 놓치면 그때 다시 받는다
- [ ] Grafana 대시보드: 앱 대시보드(개발 서버와 같음)는 넣어 둠. 서버 · 컨테이너 · LiveKit 대시보드와 팀원 계정은 첫 배포 뒤
- [x] 로그 수집(개발 서버): Loki · Alloy · 로그 대시보드, `monitoring-deploy` 다시 켬(3.3)
- [x] 로그 수집(운영): 개발과 같은 모양으로 `deploy/prod/compose.yml`에 추가(7일), 열람은 팀원 전원 Viewer(3.3)
- [ ] 개발 Grafana 팀원 계정(Viewer)
- [x] GitLab 변수 등록(7장): `prod/*`에 `CLOUDFLARE_TUNNEL_TOKEN`, `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET`(시험용 키를 버리고 **새로 만든 키**, 시험 토큰이 공유됐기 때문), `DOCKERHUB_PUSH_TOKEN` · `DOCKERHUB_PULL_TOKEN`, S3 키(`LIVEKIT_EGRESS_S3_*` · `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY`), `DB_PASSWORD` · `JWT_SECRET`. 범위 All(개발과 같은 값)에 `ADMIN_LOGIN_ID` · `ADMIN_PASSWORD` · `GRAFANA_ADMIN_PASSWORD`, 외부 API 키 3개
  - [x] Protected 정리: `CLOUDFLARE_TUNNEL_TOKEN`, 외부 API 키 3개, `ADMIN_PASSWORD`, `DB_PASSWORD`(운영), 개발 `AWS_SECRET_ACCESS_KEY`
  - [x] Egress S3 키(`LIVEKIT_EGRESS_S3_*`)를 All에서 `dev/*`로 좁힘(운영은 같은 이름의 `prod/*` 값을 씀, 4.3)
  - [x] `DEV_GRAFANA_ADMIN_PASSWORD` 지우기(10/27 변수 목록에 없음). 개발 모니터링 배포 잡(`monitoring-deploy`)은 `GRAFANA_ADMIN_PASSWORD`를 읽는다
  - [x] `JEV_API_KEY` 등록(범위 All)과 개발 · 운영 AI 에이전트 compose 연결(S15P31A301-252)
  - [ ] `INQUIRY_ENCRYPTION_KEY`: 지금은 범위 All 하나라 개발과 같은 값이다. 7장 · compose 주석은 `prod/*` · 다른 값이므로 **첫 배포 전에** 운영 값을 따로 둘지 정한다. 왜: 배포 뒤 바꾸면 이미 저장된 문의를 풀 수 없다
  - [ ] Protected 꺼진 비밀값(10/27): 운영 `DB_PASSWORD` · `CLOUDFLARE_TUNNEL_TOKEN`, `ADMIN_PASSWORD`, `INQUIRY_ENCRYPTION_KEY`, 외부 API 키 4개, `SONAR_*`, 개발 `LIVEKIT_EGRESS_S3_ACCESS_KEY`. 배포에는 영향이 없지만, 작업 브랜치 잡이 `environment: prod/...`를 붙이면 운영 값을 읽을 수 있다. 운영 값 두 개는 master에서만 쓰므로 켜도 된다
- [x] 운영 배포 사전 점검(10/27). 첫 Release MR을 막는 문제 없음
  - 코드: MR 규칙 검사(develop 커밋 메시지 467개 통과), 운영 이미지 빌드(개발과 같은 Dockerfile, 빌드 인자 차이는 FE 지표뿐), `docker compose config`, 앱이 읽는 환경 변수, 헬스체크 경로(BE · FE · AI · admin), Nginx · Prometheus · Alloy · Grafana의 컨테이너 이름
  - GitLab: `master` protected(병합 · 배포 버튼은 Maintainer), 운영에 필요한 변수 전부 있음, 러너 5개 online(`a301-prod` · `a301-mock-deploy` protected), develop · MR 최근 파이프라인 성공
  - 서버: `a301-prod` 이름의 컨테이너 · 볼륨 · 네트워크 없음(첫 배포 때 운영 값으로 새로 만든다), 7881 · 7882 · 3478 · 443 비어 있음, `rsync` · `curl` · 러너 실행 중, `/opt/a301` 러너 계정 소유, 백업 cron, TURN 인증서, 디스크 295GB · 메모리 14GB 여유
  - 알아 둘 것: 설문 주소(`NEXT_PUBLIC_SURVEY_URL`)는 빌드 때 박히는데 개발 · 운영 모두 넣지 않아 설문 버튼이 나오지 않는다

### 먼저 develop에 들어가야 하는 것

- [x] **FE 리다이렉트 버그 수정**: `/api/auth/signed-out` · `/api/auth/refresh`가 `new URL(path, request.url)`로 절대 주소를 만들어 standalone 컨테이너에서 `https://0.0.0.0:3000`으로 보낸다. 운영도 Tunnel → Nginx → FE 구조라 똑같이 생긴다 → 상대 주소(`redirectToPath`)로 고침(`f4b52c0`, S15P31A301-183)
- [ ] BE LiveKit 입장 토큰 발급 · 녹화 시작/종료, AI 에이전트, AI 녹화 합치기, FE 면접방 접속 · 다시보기(12장)
- [ ] AI 에이전트 `JEV_API_KEY` 연결(S15P31A301-252)을 develop에 병합. 빠지면 운영에서 리액션이 꺼진 채 뜬다

### 릴리즈

- [ ] Release MR(develop → master), 배포
- [ ] 스모크 테스트: 가입 → 로그인 → 지원서 → 면접 만들기 → 면접방 입장 → 면접관 질문 음성 → 답변 인식 → 리액션 → 끝내기 → 결과 → 다시보기
- [ ] TURN 접속 확인: 실제 서비스(정식 배포)로 SSAFY 강의실에서 면접방 입장(시험용 LiveKit으로는 확인함, 4.2)
- [ ] Grafana에서 면접 1건 동안 CPU · 메모리 확인(동시 면접 수 판단 근거)
- [ ] DB 백업 1회 · 복원 확인, 롤백 1회 확인

### MVP 이후

- [ ] 알림(디스크 · 메모리 임계치)
- [ ] 공시 파이프라인(로컬 PC: Airflow · MinIO → Spark), SQS · 공시 적재 worker

## 12. 명세에서 바뀌는 것

음성이 이제 서버(LiveKit → AI)를 거치므로 지금 명세와 크게 달라진다. 파트별로 다시 써야 한다. 각 파트는 자기 문서를 고친 뒤 이 표의 해당 줄도 고친다(맨 위 수정 규칙).

| 문서 · 항목 | 지금 | 바뀔 내용 | 담당 |
|---|---|---|---|
| API 명세 5.10 · 5.12 (STT · TTS 1회용 토큰) | 브라우저가 Soniox · ElevenLabs에 직접 연결 | 필요 없어진다. 대신 **LiveKit 입장 토큰 발급 API**가 새로 생긴다 | BE |
| API 명세 5.11 (리액션 REST) | 화면이 글을 보내고 리액션을 받음 | AI 에이전트가 음성을 직접 듣고 판단해 **LiveKit 데이터 메시지**로 보낸다. 메시지 형식(지금 `Reaction` · `Attitude` 스키마 재사용 여부)을 정한다 | AI · FE |
| API 명세 5.4 (면접 시작) | 화상은 이 응답 시점에 브라우저가 녹화 시작, 첫 질문 음성은 5.12 | 화상이면 BE가 Egress 녹화를 시작한다. 질문 음성은 에이전트가 면접방에서 말한다 | BE |
| API 명세 5.5 (지금 질문) | 화면이 다음 질문을 불러옴 | 에이전트가 면접방에서 질문을 말하므로, 화면이 5.5를 계속 불러야 하는지 정한다 **[미정]** | BE · FE · AI |
| API 명세 5.6 (답변 음성 업로드) | 브라우저가 답변 음성을 S3에 올림 | 필요 없어진다. 채점용 답변별 음성을 녹화 원본에서 잘라 쓸지 따로 저장할지 정한다 **[미정]**(6.1) | BE · AI |
| API 명세 5.7 (답변 제출) | 화면이 인식된 글과 음성 키를 보냄 | 화상은 에이전트가 인식한 글 · 말한 시각을 **Redis 결과 큐**로 보내고 BE가 저장한다 **[결정]**. 채팅은 지금처럼 화면이 글을 보낸다. 7초 침묵 자동 제출을 누가 판단할지 정한다 | BE · AI |
| API 명세 5.8 (면접 끝내기) | 상태 변경 · 연습 기록 | Egress 녹화 종료, 녹화 합치기 큐 작업 등록을 더한다 | BE |
| API 명세 6.1 · 6.2 (녹화 업로드) | 브라우저가 녹화해 S3에 올림 | 필요 없어진다. Egress가 서버에서 녹화하고 BE가 시작 · 종료한다(4.3) | BE · 인프라 |
| API 명세 6.4 (다시보기) | 브라우저가 올린 녹화의 주소 | 합친 mp4(`recordings/{면접 id}.mp4`)의 Presigned URL. 합치기가 끝나기 전 상태를 어떻게 보여 줄지 정한다 | BE · FE |
| AI 명세 1장 · 1.3 (작업 큐) | 분석 작업자가 DB를 직접 읽고 쓰고, Redis 진행 상태도 직접 씀 | 작업 큐는 유지하되 입력 데이터를 메시지에 담는다. 결과 · 진행 상태는 Redis 결과 큐(`ai:results`)로 보내고 BE가 저장한다. 녹화 합치기 작업(`jobType`)과 결과 메시지 형식을 추가한다 | AI · BE |
| AI 명세 6장 (실시간 반응) | 5.11 요청마다 Jev 호출 | 에이전트가 대화 흐름(질문 말하기, 듣기, 말 끊기, 리액션)을 맡는다 | AI |
| BE 설계 | 5.10 · 5.12 토큰 발급, Presigned 녹화 업로드 | 2장 패키지(STT · TTS 토큰 → LiveKit), 3장 `Recording`, 5장 흐름, 10장 S3 키를 다시 쓰고, AI 결과 큐 처리(7장 Redis 키 포함)를 더한다 | BE |
| CONTRIBUTING 2.2 · 6.1 | fe: WebSocket, be: STT · TTS 토큰, FE는 1회용 토큰으로 Provider 직접 연결 | fe: `livekit-client`, be: LiveKit 입장 토큰 · 녹화 · AI 결과 저장, FE는 BE와 LiveKit에만 붙는다 | 전체 |
| CONTRIBUTING 7장 | 음성을 BE · AI로 중계하지 않는다. AI 서비스의 DB 접근 예외 | LiveKit · AI 에이전트가 음성을 받는 구조로 원칙을 다시 쓴다. AI의 DB 접근 예외를 지우고 "DB는 BE만"으로 바꾼다 | 전체 |
| 목 서버 | 5.6 · 5.10 · 5.11 · 5.12 · 6.1 · 6.2 | 없어지는 API를 지우고 입장 토큰 API를 추가한다 | BE |
| FE `lib/tts/` 등 | ElevenLabs · Soniox 직접 연결 코드 | `livekit-client`로 바꾼다 | FE |

이전 결정(5.11을 FE → BE → AI → Jev로 보내는 C안)은 이 구조로 대체된다. 왜: 에이전트가 면접방에서 음성을 직접 들으므로, 화면이 글을 보내 리액션을 묻는 요청 자체가 필요 없어졌다.

## 13. 미정 · 확인 필요

정해지면 이 표에서 지우고, 해당 장에 결정과 이유를 적는다.

| 항목 | 상태 |
|---|---|
| 동시 녹화 수 · Egress 메모리 | **[미정]** 실측 |
| AI 에이전트 · 분석 작업자 메모리, 동시 면접 수 | **[미정]** 실측 |
| 리액션 데이터 메시지 형식(12장) | **[미정]** (AI · FE) |
| 채점용 답변별 음성, 5.5 유지 여부, 7초 자동 제출 판단 주체(12장) | **[미정]** (BE · AI · FE) |
| Redis 결과 큐 이름(`ai:results`) · 결과 메시지 형식 | **[제안]** (BE · AI) |
| BE 지표 내보내기, 알림 기준 | **[미정]** |
| 녹화 · 백업 보관 기간 | **[미정]** |
| 구조도 | 새 구조로 다시 그린다. `architecture-draft.webp`는 이전 초안 |
| LiveKit Cloud 무료 구간 정확한 값(대략은 4.0) · 팀 계정 소유자 | 대시보드 요금 화면에서 확인 (인프라) |
| 개발 서버 LiveKit을 미니PC 셀프 호스팅으로 바꿀지 | 앞 장비(통신사 공유기) 관리자 계정을 알게 되면 DMZ(→ ipTIME `192.168.45.235`) 설정 후 전환 |

## 14. 변경 기록

고칠 때마다 한 줄 남긴다. 무엇을 바꿨는지와 **왜** 바꿨는지를 같이 적는다.

| 파트 | 바꾼 곳 | 바꾼 내용 | 이유 |
|---|---|---|---|
| 인프라 | 전체 | 초안 작성: Lightsail 한 대, LiveKit 셀프 호스팅, Tunnel, Docker Hub, TURN · 녹화 · 모니터링 | 서버 비용 없이 MVP 기능(면접방 · 다시보기)을 한 서버에 올리고, 문제가 생기면 원인을 보고 나누기 위해 |
| BE | 1.1 · 2 · 3.2 · 4.3 · 7 · 12 · 13 | DB 저장은 BE만(AI는 BE 내부 API로 결과 전달), 질문 5개 고정 · 면접 중 LLM 없음, 채팅도 면접방 입장, 녹화는 화상만, 명세 변경 목록 보강 | 쓰는 곳을 BE 한 곳으로 모아 검증과 스키마 관리를 BE가 맡고, 면접 중 지연 · 실패 지점을 줄이기 위해 |
| 인프라 | 맨 위 · 각 장 | 수정 규칙과 결정별 이유(`왜:`) 추가 | 팀원이 이 문서를 기준으로 자기 파트를 고칠 때, 결정의 이유를 보고 바꿔도 되는지 판단할 수 있게 |
| BE | 1.1 · 2 · 3.2 · 4.3 · 7 · 12 · 13 | AI → BE 전달을 BE 내부 API에서 Redis 결과 큐로 변경. AI는 DB를 읽지도 않고 입력은 작업 메시지 · 배정 메타데이터로 받음. 진행 상태도 BE만 씀. 내부 API 토큰 삭제 | 분석 작업이 이미 Redis 큐라 결과도 같은 길로 받으면 내부 API 노출 · 인증 문제가 없고, DB를 BE 한 곳에서만 다루게 된다 |
| 인프라 | 1 · 4.0 · 7 · 13 | 개발은 LiveKit Cloud, 운영은 셀프 호스팅으로 나눔. LiveKit 팀원 규칙(환경 변수, Cloud 전용 기능 금지, SDK 버전, 웹훅, 테스트 데이터) 추가 | 개발 서버(미니PC)가 이중 NAT 뒤에 있어 바깥에서 미디어 포트로 들어올 수 없고, 앞 장비 관리자 계정을 몰라 해결할 수 없어서. 코드는 같게 두고 주소 · 키만 바꾸기 위해 규칙을 정함 |
| 인프라 | 3.1 · 3.3 · 4.0 · 4.2 · 5.1 · 5.2 · 11 · 13 | Lightsail 기본 셋팅 결과 기록(OS · Docker · 방화벽 · 러너 · Cloudflare · TURN 인증서). Grafana를 Cloudflare Access에서 Grafana 자체 로그인으로 변경. 시험용 LiveKit으로 TURN · UDP 접속 확인 결과와 SSAFY 와이파이 포트 실측, LiveKit Cloud 무료 구간 · 로컬 키 요청 방법 추가. 확인이 끝난 13장 항목 3개를 지우고 해당 장으로 옮김 | 운영 서버를 실제로 셋팅하며 확인한 사실을 남겨, 팀원이 같은 확인을 반복하지 않고 접속 문제가 생겼을 때 비교 기준으로 쓰게 하려고. Grafana는 팀원이 별도 인증 없이 들어갈 수 있게 하려고 |
| 인프라 | 6.1 · 7 · 8.1 · 8.2 · 11 | Docker Hub 연동 완료(비공개 저장소 `hanggeut/a301`, push · pull 토큰 분리, GitLab 변수 `prod/*`). 로그인은 작업마다 임시 폴더에서 하고 지우는 방식, 빌드 작업에 `prod/build` 환경 이름을 붙이는 방식 추가. 계정 · 저장소 이름은 변수가 아니라 CI 파일에 적기로 함 | 운영 이미지를 받아 올 경로를 미리 확인하고, 토큰이 서버나 develop 파이프라인에 새지 않게 하려고 |
| 인프라 | 11 | 준비 항목 재확인(10/26): 서버 셋팅 · ufw · DNS · TURN 인증서 · 러너가 그대로임을 확인. GitLab `prod/*` 변수 현황 반영(Docker Hub 토큰 등록됨, 남은 비밀값 · 플래그 정리 항목 추가), Egress S3 키를 `dev/*`로 좁힘. FE 리다이렉트 버그 완료 처리 | 체크리스트가 실제 상태보다 늦어 남은 일을 잘못 판단하지 않게 하려고. dev 녹화 키가 운영으로 넘어가지 않게 하려고 |
| 인프라 | 6.1 · 6.2 · 11 · 13 | 운영 S3 버킷 `hanggeut-a301-prod` 생성과 설정(퍼블릭 차단 · CORS · HTTPS 정책 · 미완료 멀티파트 정리) 기록. IP 조건을 서버 요청(`REST-HEADER`)에만 거는 안 추가. 13장의 버킷 이름 · 개발용 녹화 저장소 항목을 6.1로 옮김 | 버킷 이름과 설정을 정해 BE · Egress · AI가 같은 값을 쓰게 하려고. IP 조건을 모든 요청에 걸면 브라우저의 Presigned URL 요청이 막히기 때문 |
| 인프라 | 4.3 · 6.1 · 6.2 · 7 · 11 | IAM 사용자 · 정책 생성(운영 `a301-prod-egress` · `a301-prod-app`, 개발 `a301-dev-app`)과 GitLab 변수 등록. 운영 녹화도 개발처럼 BE가 S3 키를 녹화 요청에 담아 보내기로 함(Egress 설정 파일에 키를 두지 않음). 개발 BE에 앱 키(`AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY`)를 넘기도록 `deploy/dev/compose.yml` 수정. IP 조건은 첫 운영 배포 확인 뒤로 미룸 | 개발과 운영이 같은 코드 · 같은 compose로 돌고 키 값만 다르게 하려고. 개발 프로필 사진 API가 키가 없어 실패하던 것도 함께 고침 |
| 인프라 | 7 · 11 | 남은 GitLab 변수 등록(운영 `DB_PASSWORD` · `JWT_SECRET`)과 Protected 정리. 관리자 계정 · `GRAFANA_ADMIN_PASSWORD` · 외부 API 키는 개발과 같은 값(범위 All)으로 두는 예외 추가. 개발 모니터링 변수 이름을 `DEV_GRAFANA_ADMIN_PASSWORD`에서 `GRAFANA_ADMIN_PASSWORD`로 바꾸고(`deploy/dev/monitoring`), 이미 떠 있는 개발 모니터링의 배포 잡 `monitoring-deploy`는 주석 처리 | 개발과 운영이 같은 이름 · 같은 compose를 쓰게 하려고. 관리자 · Grafana는 팀이 한 계정으로 관리하고, 외부 API 키는 서비스마다 하나로 쓰기 때문 |
| 인프라 | 3.2 · 4.1 · 9 · 11 | 운영 배포 파일 `deploy/prod/` 작성(개발 compose와 같은 이름 · 환경 변수, 이미지만 Docker Hub). 서버에서 설정 검사, LiveKit · Egress 시험 기동, 공개 이미지 미리 받기, 백업 스크립트 · cron 설치, 시험 이미지 정리. 백업 방식(cron + 배포 작업이 쓰는 키 파일) 결정. `/be/`는 관리 페이지가 써서 연다 | 서버 쪽 준비를 끝내 남은 일을 CI 작업 하나로 줄이려고. 첫 배포 전에 설정 오류 · 이미지 문제를 미리 걸러 내려고 |
| 인프라 | 3.2 · 13 | 운영 Swagger 미공개 결정: BE에서 끄고 Nginx에서도 경로를 404로 막음. 13장의 Swagger 공개 항목 삭제 | 운영 API 구조를 바깥에 드러낼 이유가 없고, API 확인은 개발 서버 Swagger로 충분해서 |
| 인프라 | 3.2 · 7 | AI 분석 작업자 배포 추가: 개발 `a301-dev-ai-analysis`(CI `ai-analysis-deploy`) · 운영 `a301-prod-ai-analysis`. GMS 주소 · 모델은 회사 카드 파이프라인과 같은 값을 compose에 적고 키는 `LLM_API_KEY`. 헬스체크는 Redis 연결, 컨테이너는 하나로 고정 | 작업자가 어디에도 떠 있지 않아 플랜 생성이 처리되지 않았다. 처리 중 리스트를 공유하는 구조라 늘리면 중복 처리되므로 하나로 둔다 |
| 인프라 | 3.3 · 11 | 로그 수집을 MVP에 넣음: 개발 서버에 Loki 3.7.8 · Alloy v1.20.1 · Grafana 로그 대시보드 추가(3일 보관, `a301-dev-*`만 수집), 꺼 두었던 `monitoring-deploy` 다시 켬 | 팀원이 SSH 없이 로그를 보게 하고, 재배포해도 로그가 남게 하려고 |
| 인프라 | 7 | 운영 BE에 `INQUIRY_ENCRYPTION_KEY` 추가(compose · GitLab 변수 `prod/*`) | 문의 API가 이 키를 필수로 요구해 없으면 운영 BE가 기동하지 않는다 |
| 인프라 | 3.2 · 3.3 · 8.1 · 11 | 운영 CI 작성(`prod-build` 자동 · `prod-deploy` 버튼, `deploy/prod/deploy.sh`, `workflow`에 master 추가). 결정: 운영 배포는 ▶ 버튼, 이미지는 yobi 미니PC에서 빌드, 운영 로그 수집을 첫 배포에 넣고 팀원 전원 Viewer · 7일, 러너 토큰은 다시 받지 않음 | 배포 시점을 사람이 골라 진행 중인 면접을 끊지 않고, 첫 배포 문제를 로그로 보려고. 각 결정의 이유는 해당 장 |
| 인프라 | 7 | 개발 · 운영 compose의 AI 에이전트에 `JEV_API_KEY` 전달 추가(범위 All, 없으면 리액션 없이 진행) | GitLab 변수는 compose `environment:`에 적은 것만 컨테이너로 들어가, 키를 등록해도 리액션이 꺼진 채 떴다 |
| 인프라 | 11 | 운영 배포 사전 점검 결과 기록(코드 · GitLab · 서버 · Cloudflare), Cloudflare 호스트 이름 확인 · `DEV_GRAFANA_ADMIN_PASSWORD` 삭제 체크. 남은 것으로 문의 암호화 키 범위 결정, Protected 꺼진 비밀값 추가 | 첫 Release MR 전에 막히는 곳이 없는지 확인하고, 첫 배포 뒤에는 바꿀 수 없는 결정(문의 키)을 놓치지 않으려고 |
| 인프라 | 6.2 · 7 | 녹화 합치기 연결: AI 이미지(`ai/Dockerfile`)에 ffmpeg 설치(앞 레이어, `--no-install-recommends`), CI `ai-test`는 녹화 코드 · 시험 · AI 이미지가 바뀐 MR에서만 ffmpeg를 설치해 실제 시험을 돌림, 개발 · 운영 분석 작업자에 BE와 같은 버킷 · 앱 키(`S3_BUCKET` · `AWS_REGION` · `AWS_*`) 전달 | ffmpeg가 없으면 모든 합치기가 `MERGE_ERROR`, S3 설정이 없으면 `STORAGE_ERROR`가 된다. 앱 키 정책에 이미 `recordings/*` 읽기 · 쓰기와 `ListBucket`이 있어 새 IAM 키를 만들지 않는다. CI 설치는 필요한 MR에서만 해 다른 AI MR의 시간을 아낀다 |
| 인프라 | 3.2 · 3.3 | 운영 대시보드 작성: 지표 대시보드를 전체 현황 · 서버 · 컨테이너 · BE · AI · LiveKit · Redis · PostgreSQL · FE 줄로 다시 구성, 로그 대시보드에 수준 필터 · 흐름별 오류 패널 추가. Redis · PostgreSQL exporter 추가(각 64m), cAdvisor 상한 256m → 384m. 3.2의 메모리 합계를 실제 상한 합으로 고침(5.2GB → 6.6GB) | 개발 대시보드를 복사한 상태라 이미 모으던 서버 · 컨테이너 · LiveKit 지표를 화면에서 볼 수 없었다. Redis가 차면 로그인이 막히는데 그 사용량을 볼 곳이 없었다. cAdvisor는 로컬에서 운영 구성으로 띄웠을 때 256m의 87~93%를 써 강제 종료될 수 있었다 |
| 인프라 | 3.2 · 3.3 · 7 | 분석 작업자를 작업 큐별로 나눔: 질문 생성 `a301-*-ai-plan`(`AI_WORKER_QUEUE=plan`, 256m) · 녹화 합치기 `a301-*-ai-recording`(`AI_WORKER_QUEUE=recording`, 256m · `cpus: 1`) 추가, 기본 작업자 `ai-analysis`는 채점 · 결과 생성. 세 작업자의 공통 설정은 compose `x-ai-worker` 등 앵커 한 곳에 둠. CI `ai-plan-deploy` · `ai-recording-deploy` 추가, 대시보드 AI 작업 큐 패널을 큐별(`sum by (queue)`)로 변경 | 작업자 하나가 모든 작업을 차례로 처리해, 녹화 합치기 · 결과 생성이 몰리면 사용자가 기다리는 질문 생성이 3분 안에 끝나지 않아 실패로 처리되고, 사용자는 면접을 시작하지 못한 채 다시 시도해야 한다(AI 명세 1.3). 녹화 합치기는 ffmpeg가 CPU를 써서 4코어를 실시간 면접과 나눠 쓰도록 제한한다 |
| 인프라 | 3.2 | 운영 BE 상한 768m → 1280m, JVM 옵션에 `-XX:+ExitOnOutOfMemoryError` 추가. 3.2의 메모리 합계 6.6GB → 7.1GB | 운영 BE 이미지를 같은 JVM 옵션 · SerialGC(상한 1.5GB 이하에서 JVM이 고르는 GC)로 로컬에서 띄워 보니, 가벼운 부하만으로 약 690MiB(768m의 90%)를 썼고 힙 512MB를 모두 쓰면 약 1.06GB였다. 768m로는 힙이 차기 전에 컨테이너가 강제 종료될 수 있다. 1g도 최악값보다 작아 1280m로 여유를 두었다. 힙 할당이 실패하면 반쯤 망가진 채로 요청을 받지 않고 바로 종료해 restart로 다시 뜨게 한다 |
| 인프라 | 3.2 | 운영 AI 에이전트 상한 1g → 4g. 3.2 합계를 모든 컨테이너 상한 합(약 11.8GB)으로 다시 적고, 이 서버 한 대의 동시 면접 한계를 적음 | 면접마다 처리 프로세스(약 150~200MB, 추정)가 면접이 끝날 때까지 떠 있어 1g로는 동시 4~6건에서 메모리가 넘쳐 진행 중인 면접이 모두 끊긴다. 동시 면접을 많이 받으려고 서버(15GB)에서 다른 상한을 빼고 남는 만큼 줬다. 100건처럼 그 이상은 에이전트 하나가 서버 메모리를 넘으므로 서버를 나눠야 한다 |
| BE · 인프라 | 7 | BE의 브라우저용 LiveKit 주소 설정 이름을 `livekit.url` → `livekit.public-url`로 바꿈(hotfix, S15P31A301-285). 운영과 같이 두 주소를 다르게 넣는 재현 시험(`LiveKitInterviewRoomTest`) 추가. 환경 변수 이름(`LIVEKIT_URL` · `LIVEKIT_PUBLIC_URL`)과 compose는 그대로 | 첫 운영 배포에서 면접방에 들어갈 수 없었다. Spring이 환경 변수 `LIVEKIT_URL`(내부 주소)을 같은 이름의 설정 `livekit.url`로 읽어 `application.yml`의 `LIVEKIT_PUBLIC_URL` 값을 덮어써서, 브라우저가 `ws://a301-prod-livekit:7880`으로 접속하려다 막혔다. 개발 서버는 두 값이 같아 드러나지 않았다. compose로 덮는 임시 우회 대신 설정 이름을 환경 변수와 겹치지 않게 바꿔, 두 주소가 다른 어느 환경에서도 다시 생기지 않게 했다 |
| 인프라 | 3.2 | 운영 Grafana 상한 384m → 768m, `GOMEMLIMIT=512MiB` 추가. 3.2 합계 약 11.8GB → 12.2GB | 10/28 운영 Grafana가 프로세스 메모리 약 380MB로 상한에 걸려 두 번 강제 종료됐다(dmesg `Memory cgroup out of memory`). 다시 뜬 뒤에도 실행 파일(약 195MB)이 메모리에서 밀려나 디스크를 계속 다시 읽었다 |
| 인프라 | 3.1 · 11 · 13 | CPU 기준치를 vCPU당 40%로 확인(Linux $84 플랜, 2026-10-21 생성), 13장에서 뺌 | AWS 문서의 플랜별 기준치 표와 서버 첫 부팅 날짜(`cloud-init.log`)로 확인했다. 2023-06-29 이전 서버면 22.5%라 생성 날짜까지 확인했다. 부하 테스트 서버(t3.xlarge)도 vCPU당 40%라 결과를 운영에 옮길 수 있다 |
