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
| CPU 버스트 | Lightsail 플랜은 버스트형(기준 CPU 사용률이 있음)이다. 미디어 중계 · AI가 기준치를 넘겨 CPU를 오래 쓰면 크레딧이 바닥나 서버 전체가 느려지므로 플랜의 기준치를 확인한다 **[확인 필요]** | 동시 면접 수를 정할 때 이 기준치가 상한이 된다 |

### 3.2 컨테이너

| 컨테이너 | 역할 | 외부 노출 | 메모리 상한 **[제안]** |
|---|---|---|---|
| `a301-prod-cloudflared` | Cloudflare Tunnel(`hangguet.co.kr`, `rtc.hangguet.co.kr`, `grafana.hangguet.co.kr`) | 밖으로 나가는 연결만 | 64m |
| `a301-prod-nginx` | `/` → FE, (`/be/` → BE Swagger, 운영 공개 **[미정]**) | 없음 | 64m |
| `a301-prod-fe` | Next standalone. `livekit-client`로 면접방 접속. `API_BASE_URL=http://a301-prod-be:8080/api/v1` | 없음 | 512m |
| `a301-prod-be` | CRUD + LiveKit 입장 토큰 발급 + 녹화 시작 · 종료 요청 + 큐 작업 등록 + AI 결과 큐 처리(저장). DB를 다루는 유일한 서비스. `-Xmx512m` | 없음 | 768m |
| `a301-prod-livekit` | 미디어 서버 + TURN(4장) | UDP 7882, TCP 7881, UDP 3478, TCP 443 | 512m |
| `a301-prod-egress` | 서버 녹화(4.3). 트랙 녹화라 인코딩을 하지 않는다 | 없음 | 1g **[제안]** 실측 |
| `a301-prod-ai-agent` | 면접방 참가자. STT → Jev, 질문 TTS, 리액션 데이터 메시지, 질문 시작 · 답변을 Redis 결과 큐로 전달. 질문 5개 · 채점 기준은 배정 메타데이터로 받는다 | 없음 | **[미정]** 면접 1건마다 처리 프로세스가 생겨 동시 면접 수에 비례. 실측 |
| `a301-prod-ai-analysis` | Redis 큐 작업(PLAN · SCORE_ANSWER · EVALUATE) + 녹화 합치기(ffmpeg). 입력은 작업 메시지로 받고, 진행 상태 · 결과는 Redis 결과 큐로 전달 | 없음 | **[미정]** 음성 분석 라이브러리 · ffmpeg를 정한 뒤 실측 |
| `a301-prod-postgres` | 메인 DB(PostgreSQL 18) | 없음 | 1g |
| `a301-prod-redis` | 세션 · 리프레시 토큰 · 작업 큐 · 결과 큐. `noeviction`(차면 쓰기가 거절되어 로그인까지 실패하므로 넉넉히) | 없음 | 256m |
| `a301-prod-prometheus` · `grafana` · `cadvisor` · `node-exporter` | 모니터링(3.3) | 없음(Grafana만 Tunnel) | 합계 약 1g |

AI 두 컨테이너를 뺀 합계 약 5.2GB다. 나머지를 AI · OS · 러너가 나눠 쓴다. 이미지 빌드는 이 서버에서 하지 않는다(8장).

- 왜 외부 노출을 LiveKit만 하나: 바깥에서 직접 닿는 곳이 적을수록 공격받을 지점이 줄어든다(1.1). 웹은 Tunnel로만 들어온다
- 왜 AI 메모리는 [미정]인가: 에이전트는 면접마다 프로세스가 늘고, 분석 작업자는 라이브러리가 정해지지 않았다. 추측으로 잡으면 강제 종료가 나거나 메모리를 낭비하므로 실측해서 정한다

### 3.3 모니터링 **[결정]**(구성은 **[제안]**)

| 구성 | 보는 것 |
|---|---|
| Prometheus | 지표 수집 · 저장(보존 15일 정도) |
| node-exporter | 서버 CPU · 메모리 · 디스크 · 네트워크 |
| cAdvisor | 컨테이너별 CPU · 메모리(어느 서비스가 무거운지) |
| LiveKit · Egress 내장 지표 | 면접방 · 참가자 수, 패킷 손실, 녹화 상태. `livekit.yaml`의 `prometheus_port`로 내보낸다 |
| Grafana | 대시보드. `grafana.hangguet.co.kr`을 Tunnel로 열고 **Grafana 자체 로그인**(아이디 · 비밀번호)으로 막는다 **[결정]** |

- 의도: 서버 한 대에 모든 서비스가 있으므로, 느려졌을 때 "어느 컨테이너 때문인지"를 바로 알아야 한다. 그래야 그 서비스만 떼어 낼지(MSA) 판단할 수 있다(1.1)
- 왜 Grafana 자체 로그인: 팀원이 Cloudflare 계정이나 이메일 인증 없이 아이디 · 비밀번호로 바로 들어갈 수 있다. 대신 로그인 화면이 인터넷에 열리므로 아래를 지킨다 **[제안]**
  - 관리자 비밀번호는 `GRAFANA_ADMIN_PASSWORD`(7장)로 길고 무작위로 둔다. 기본값(`admin/admin`)으로 뜨지 않게 한다
  - 회원가입(`GF_USERS_ALLOW_SIGN_UP=false`)과 익명 접근(`GF_AUTH_ANONYMOUS_ENABLED=false`)을 끈다. 둘 다 Grafana 기본값도 꺼져 있지만 compose에 명시한다
  - 팀원은 관리자 계정을 같이 쓰지 않고 각자 계정(보기 권한)을 만든다. 누가 무엇을 바꿨는지 남는다
  - 로그인 시도 제한(Grafana 기본 기능)을 끄지 않는다
- BE 지표(요청 수 · 응답 시간)는 Spring Actuator에 Prometheus 내보내기를 추가해야 한다(BE 작업, **[미정]**)
- 로그 수집(Loki)은 MVP에서 빼고 `docker logs`로 본다 **[제안]**. 왜: 메모리를 더 쓰고, MVP 규모에서는 `docker logs`로 충분하다
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
| 저장 | Egress가 S3 `recordings/raw/{면접 id}/`에 바로 올린다 | 서버 디스크를 거치지 않아 디스크가 차지 않고, 서버가 죽어도 원본이 남는다 |
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
| S3 버킷 하나 (우리 AWS 계정) | 접두사 `profile/` · `recordings/raw/`(트랙 원본) · `recordings/`(합친 mp4) · `backup/`. Block Public Access 켬. 브라우저 업로드 · 재생은 Presigned URL. 버킷 이름 **[미정]** | 버킷 하나에 접두사로 나누면 권한을 접두사 단위로 줄 수 있다. 공개를 막고 Presigned URL로만 주면 남의 파일을 볼 수 없다 |
| Docker Hub (운영 이미지) | **비공개 저장소 `hanggeut/a301`**에 서비스를 태그로 구분한다: `be-<커밋 SHA>` · `fe-<커밋 SHA>` · `ai-<커밋 SHA>` **[결정]**. 토큰은 push용(Read & Write, `a301-ci-push`)과 pull용(Read-only, `a301-prod-pull`) 두 개 | 무료 플랜은 비공개 저장소가 1개라 태그로 나눈다. 공개 저장소는 쓰지 않는다(이미지 안에 코드가 그대로 들어 있다). 토큰을 나눠 운영 서버의 토큰이 새도 이미지를 바꿔치기할 수 없게 한다 |

녹화 원본은 Egress가, 합친 영상은 AI 분석 작업자가 S3에 올린다(4.3). 채점에 쓸 답변별 음성을 녹화 원본에서 잘라 쓸지 따로 저장할지는 12장에서 정한다.

### 6.2 IAM **[제안]**

IAM 역할을 못 쓰므로 IAM 사용자 키를 서버에 둔다. 키마다 권한을 최소로 하고, 버킷 정책에 `aws:SourceIp` = Lightsail 공인 IP 조건을 걸어 키가 새도 다른 곳에서는 못 쓰게 한다.

| 키 | 쓰는 곳 | 허용 |
|---|---|---|
| `a301-prod-app` | BE(Presigned URL), AI(녹화 합치기 · 음성 파일), 백업 스크립트 | S3 해당 접두사 읽기·쓰기 |
| `a301-prod-egress` | Egress | S3 `recordings/raw/` 쓰기만 |

- 왜 키를 나누나: 한 키가 새도 피해 범위가 그 키의 권한으로 한정된다. Egress는 녹화 원본을 쓰는 일만 하므로 읽기도 주지 않는다

Docker Hub는 액세스 토큰을 권한별로 나눈다 **[제안]**: push용(Read & Write)은 이미지 빌드 작업에만, pull용(Read-only)은 Lightsail 배포 작업에만 쓴다. 왜: 운영 서버에 있는 토큰이 새도 이미지를 바꿔치기할 수 없다.

## 7. 비밀값 · 설정값

GitLab CI/CD Variables. 비밀값은 Protected · Masked, 환경 범위 `prod/*`. 개발 서버와 **다른 값**을 쓴다 **[결정]**. 왜: 개발 서버 값이 새도 운영에는 영향이 없고, Protected라 보호 브랜치(master) 파이프라인에서만 읽힌다.

| 이름 | 비밀 | 쓰는 곳 |
|---|---|---|
| `DB_PASSWORD` | O | postgres, BE(AI는 DB에 접속하지 않는다) |
| `JWT_SECRET` | O | BE |
| `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET` | O | livekit, BE(입장 토큰 서명), AI 에이전트 |
| `SONIOX_API_KEY` | O | AI 에이전트. STT 실행 필수이며 브라우저에 전달하지 않는다 |
| `ELEVENLABS_API_KEY` · `JEV_API_KEY` | O | AI 에이전트 연결 예정. 현재 AI 공통 설정의 변수 이름 |
| `LLM_API_KEY` | O | AI(GMS). 이름은 공시 파이프라인([`company-pipeline/pipeline/README.md`](../../company-pipeline/pipeline/README.md))과 같게 한다 |
| `CLOUDFLARE_TUNNEL_TOKEN` | O | cloudflared |
| Cloudflare DNS API 토큰 | O | certbot(TURN 인증서, DNS 편집 권한만). 서버에 파일로 둔다(권한 600) |
| `GRAFANA_ADMIN_PASSWORD` | O | Grafana |
| AWS 키(6.2) | O | 각 사용처 |
| `DOCKERHUB_PUSH_TOKEN` | O | 이미지 빌드 작업(미니PC 러너)만. 이 작업에도 `prod/` 환경 이름을 붙여야 읽힌다(8.1) |
| `DOCKERHUB_PULL_TOKEN` | O | Lightsail 배포 작업만 |
| 계정 `hanggeut` · 저장소 `hanggeut/a301` | X | 빌드 · 배포 작업. 비밀이 아니라 GitLab 변수가 아니라 `.gitlab-ci.yml`에 적는다 |
| `LLM_CHAT_URL` · `LLM_MODEL` | X | AI |
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
→ (미니PC 러너) be · fe · ai 이미지 빌드 → Docker Hub push (태그: be-/fe-/ai-<커밋 SHA>) → 미니PC 이미지 정리
→ (Lightsail 러너, 태그 a301-prod) Docker Hub 로그인(pull 토큰) → docker compose pull → up -d → 헬스 체크 → 이미지 정리
```

| 결정 | 왜 |
|---|---|
| **운영 서버만 Docker Hub를 쓴다** **[결정]**. 개발 서버(develop → 미니PC)는 지금처럼 미니PC 러너가 그 자리에서 빌드해 띄운다(`deploy/dev/compose.yml`의 `build`) | 개발 서버는 빌드하는 곳과 도는 곳이 같아 레지스트리를 거칠 필요가 없다. 운영 서버는 다른 곳이라 이미지를 받아 와야 한다 |
| SSAFY GitLab은 Container Registry가 꺼져 있어 외부 레지스트리(Docker Hub)를 쓴다 | GitLab 레지스트리를 쓸 수 없다 |
| Docker Hub 로그인은 **작업마다 임시 폴더**(`DOCKER_CONFIG=$(mktemp -d)`)에서 하고, 작업이 끝나면 로그아웃하고 지운다 | 로그인 정보가 서버(`~/.docker/config.json`)에 암호화되지 않은 채 남지 않게 한다 |
| 이미지 빌드 작업에 `environment: { name: prod/build, action: prepare }`를 붙인다 **[제안]** | push 토큰 범위가 `prod/*`라 이 이름이 있어야 읽힌다. develop 파이프라인에서는 push 토큰이 보이지 않는다 |
| 운영 서버에서는 빌드하지 않는다 | Gradle · Next 빌드가 서비스 메모리를 잡아먹어 서비스가 죽을 수 있다 |
| 같은 이미지를 환경만 바꿔 띄우므로 이미지에 환경별 값을 넣지 않는다. FE가 브라우저에 알려 줄 값(LiveKit 주소 등)도 빌드 때 박는 `NEXT_PUBLIC_*` 대신 실행 시점 값(BE 응답이나 서버 환경 변수)으로 넘긴다 **[제안]** | 값을 빌드 때 넣으면 환경마다 이미지를 다시 만들어야 하고, 같은 이미지로 롤백할 수 없다 |
| Lightsail에 **protected** GitLab 러너(shell executor)를 둔다. master 파이프라인만 실행한다 | 아무 브랜치에서나 운영 서버 명령이 돌면 안 된다. 러너가 GitLab에 먼저 접속하므로 포트를 열 필요가 없다 |
| 배포 작업은 `resource_group`으로 한 번에 하나만, 헬스 체크는 루프백 포트로 한다 **[제안]** | 배포가 겹치면 컨테이너 상태가 꼬인다. 헬스 체크 포트는 바깥에 열지 않는다 |
| master 병합 시 자동 배포 **[제안]** | master에는 검증된 Release MR만 들어오므로(CONTRIBUTING 9장) 사람 손을 줄인다 |

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

- 매일 `pg_dump` → S3 `backup/`(서버 cron 또는 컨테이너). 보관 기간 **[미정]**
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
- [ ] Lightsail 플랜의 CPU 기준치 확인
- [x] 포트 열기(UDP 7882 · 3478, TCP 7881 · 443), 바깥 네트워크와 SSAFY 와이파이에서 확인
- [x] Cloudflare `a301-prod` 터널(`hangguet.co.kr`, `rtc.hangguet.co.kr`, `grafana.hangguet.co.kr`), `turn.hangguet.co.kr` DNS(프록시 끔), Always Use HTTPS
- [x] TURN 인증서: certbot + Cloudflare DNS 플러그인 발급, 자동 갱신 · LiveKit 재시작 hook
- [x] 시험용 LiveKit으로 TURN · UDP 접속 확인(SSAFY 와이파이 · 핫스팟)
- [x] 시험용 컨테이너(`a301-prod-livekit`, `cloudflared-try`) · 네트워크(`a301-try`) · `~/livekit-try` 정리. **정식 이름으로 띄운 시험 컨테이너가 남으면 CI 배포와 충돌한다**
- [x] Docker Hub 비공개 저장소(`hanggeut/a301`) · push/pull 토큰 · GitLab 변수. 미니PC push, Lightsail pull 성공, pull 토큰으로 push가 막히는 것(`insufficient scopes`)까지 확인
- [ ] S3 버킷, IAM 키(6.2)
- [x] Lightsail에 protected 러너 등록(`a301-prod`, shell)
- [x] 러너 토큰 재발급: 등록 확인 출력(`gitlab-runner list`)에 토큰이 찍혀 공유돼, 러너를 지우고 새로 등록했다
- [ ] `deploy/prod/compose.yml` · `livekit.yaml` · Egress 설정 · Prometheus 설정 · Nginx 설정, CI 작업(이미지 빌드 · `prod-deploy`)
- [ ] Grafana 대시보드(서버 · 컨테이너 · LiveKit), 팀원 계정
- [ ] GitLab 변수(`prod/*`) 등록: `CLOUDFLARE_TUNNEL_TOKEN`, `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET`(시험용 키를 버리고 **새로 만든 키**, 시험 토큰이 공유됐기 때문), `DOCKERHUB_PUSH_TOKEN` · `DOCKERHUB_PULL_TOKEN` 등록함. 나머지(`DB_PASSWORD` · `JWT_SECRET` · `GRAFANA_ADMIN_PASSWORD` · AWS 키 2개)는 남음
  - [ ] `CLOUDFLARE_TUNNEL_TOKEN` Protected 켜기(지금 Masked만)
  - [ ] 외부 API 키(`SONIOX_API_KEY` · `ELEVENLABS_API_KEY` · `LLM_API_KEY`)가 범위 All · Protected 꺼짐. 운영에 다른 키를 쓰면 `prod/*`로 따로 넣고 이 셋을 `dev/*`로 좁힌다. 같은 키를 쓰면 Protected만 켠다 **[미정]**
  - [x] Egress S3 키(`LIVEKIT_EGRESS_S3_*`)를 All에서 `dev/*`로 좁힘(운영은 Egress 서버 설정의 저장소를 씀, 6.2)

### 먼저 develop에 들어가야 하는 것

- [x] **FE 리다이렉트 버그 수정**: `/api/auth/signed-out` · `/api/auth/refresh`가 `new URL(path, request.url)`로 절대 주소를 만들어 standalone 컨테이너에서 `https://0.0.0.0:3000`으로 보낸다. 운영도 Tunnel → Nginx → FE 구조라 똑같이 생긴다 → 상대 주소(`redirectToPath`)로 고침(`f4b52c0`, S15P31A301-183)
- [ ] BE LiveKit 입장 토큰 발급 · 녹화 시작/종료, AI 에이전트, AI 녹화 합치기, FE 면접방 접속 · 다시보기(12장)

### 릴리즈

- [ ] Release MR(develop → master), 배포
- [ ] 스모크 테스트: 가입 → 로그인 → 지원서 → 면접 만들기 → 면접방 입장 → 면접관 질문 음성 → 답변 인식 → 리액션 → 끝내기 → 결과 → 다시보기
- [ ] TURN 접속 확인: 실제 서비스(정식 배포)로 SSAFY 강의실에서 면접방 입장(시험용 LiveKit으로는 확인함, 4.2)
- [ ] Grafana에서 면접 1건 동안 CPU · 메모리 확인(동시 면접 수 판단 근거)
- [ ] DB 백업 1회 · 복원 확인, 롤백 1회 확인

### MVP 이후

- [ ] 로그 수집(Loki), 알림
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
| Lightsail 플랜의 CPU 기준치 | 확인 필요 |
| 동시 녹화 수 · Egress 메모리 | **[미정]** 실측 |
| AI 에이전트 · 분석 작업자 메모리, 동시 면접 수 | **[미정]** 실측 |
| 리액션 데이터 메시지 형식(12장) | **[미정]** (AI · FE) |
| 채점용 답변별 음성, 5.5 유지 여부, 7초 자동 제출 판단 주체(12장) | **[미정]** (BE · AI · FE) |
| Redis 결과 큐 이름(`ai:results`) · 결과 메시지 형식 | **[제안]** (BE · AI) |
| BE 지표 내보내기, 알림 기준 | **[미정]** |
| 운영 BE Swagger 공개, S3 버킷 이름, 녹화 · 백업 보관 기간 | **[미정]** |
| 구조도 | 새 구조로 다시 그린다. `architecture-draft.webp`는 이전 초안 |
| LiveKit Cloud 무료 구간 정확한 값(대략은 4.0) · 팀 계정 소유자 | 대시보드 요금 화면에서 확인 (인프라) |
| 개발용 녹화 저장소 | 개발에서는 LiveKit Cloud 서버가 S3에 직접 올리므로 운영 버킷의 `aws:SourceIp` 조건(6.2)에 막힌다. 개발용 버킷(또는 접두사)과 IAM 키를 따로 둔다 **[제안]** (인프라) |
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
