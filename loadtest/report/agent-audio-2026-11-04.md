# 면접 에이전트 음성 조각 크기와 CPU (2026-11-04)

[S5 보고서](s5-2026-11-02.md)에서 CPU를 가장 많이 쓴 것은 면접 에이전트였다(면접 1건당 약 0.12~0.16코어). 에이전트가 CPU를 어디에 쓰는지 재고, 음성을 주고받는 조각을 10ms → 100ms로 키운 효과를 로컬과 개발 서버에서 비교한다.

## 요약

- **에이전트 CPU는 대부분 "10ms 조각을 초당 100번 넘기는 비용"이다.** Opus 풀기 · 압축, 16kHz 변환, 우리 파이썬 로직은 합쳐 1% 안팎이다(3장). 실제 방에서는 음성 조각을 받기 시작할 때와 질문 음성을 내보낼 때 CPU가 크게 오른다(4장)
- **조각을 100ms로 키우면 로컬에서 답변 듣는 동안 8.5~10.8% → 3.2~3.4%, 질문 내보내기 9.9~14.7% → 5.0~7.6%(코어 사용률)로 줄었다(4장).** 그래서 받는 쪽 · 보내는 쪽 모두 100ms로 바꿨다(5장)
- **개발 서버 변경 전(면접 2건 동시 × 2회)은 서버 CPU 평균 30.0% · 31.5%다(6장).** 면접이 끝난 뒤 녹화 합치기가 돌던 때의 값은 뺐다. 회차 평균은 비슷하지만, 면접 중에도 같은 서버에서 채점이 돌아 한 회차 안의 값이 24~41%로 흔들린다
- 변경 후는 머지 · 배포 뒤 같은 방법으로 재서 7장에 채운다

## 1. 확인한 사실(문서)

| 항목 | 내용 | 출처 |
|---|---|---|
| 코덱 | WebRTC 음성 코덱은 Opus와 G.711뿐이고, LiveKit 방은 Opus(와 RED)만 받는다. G.711은 전화(SIP)용 · 8kHz다. Opus를 빼는 선택지는 없다 | [RFC 7874](https://www.rfc-editor.org/pdfrfc/rfc7874.txt.pdf), [LiveKit 설정 예시](https://www.github.com/livekit/livekit/blob/master/config-sample.yaml), [LiveKit 전화 코덱](https://docs.livekit.io/reference/telephony/codecs-negotiation/) |
| 규모 | LiveKit 권장은 에이전트 서버 4코어 · 8GB에 동시 작업 10~25개. 공식 시험(4코어에 에이전트 30개, 음성 받기 + VAD + 사인파 내보내기)은 최대 약 3.8코어, 에이전트 1개 약 0.13코어 | [LiveKit 배포 문서](https://docs.livekit.io/deploy/custom/deployments/) |
| STT 조각 | Soniox는 실시간 속도로 보내기만 요구하고, 예제는 4096바이트(16kHz · 16비트 · 모노로 약 128ms)씩 보낸다 | [Soniox WebSocket API](https://soniox.com/docs/stt/api-reference/websocket-api), [실시간 전사](https://soniox.com/docs/speech-to-text/core-concepts/real-time-transcription) |

우리 에이전트(면접 1건 0.12~0.16코어)는 LiveKit 공식 시험과 같은 수준이다. S5에서 동시 5건이 한계였던 것은 4코어를 BE · 녹화 · FE와 나눠 쓰기 때문이다.

## 2. 측정 환경

| 항목 | 값 |
|---|---|
| 로컬 PC | Windows 11, 22스레드. LiveKit 서버 `livekit/livekit-server:v1.13.10`(운영과 같은 버전, `--dev`), Python SDK `livekit` 1.1.20 · `livekit-agents` 1.8.8 |
| 로컬 재는 법 | 단계마다 30초 동안 그 프로세스의 CPU 시간(모든 스레드, LiveKit Rust 포함) ÷ 경과 시간. 외부 API 대신 로컬 가짜 서버를 쓴다(Soniox 대신 TLS WebSocket) |
| 개발 서버 | 미니PC 4코어. 서버 전체 CPU는 BE(JVM)가 내는 `system_cpu_usage`(Grafana 데이터 소스 `a301-prometheus`, 30초 간격)로 본다. BE 프로세스만 보는 `process_cpu_usage`(0.2%)와 달리 서버 전체 값(평소 약 15%)이다. 개발 Prometheus에는 컨테이너별 CPU(cAdvisor)가 없다 |

## 3. 로컬 측정 1: 부분별(LiveKit 서버 없이)

오디오 60초를 처리하는 데 든 CPU(`loadtest/agent-audio/parts.py`).

| 부분 | CPU(코어 사용률) |
|---|---|
| Opus 풀기(지원자 음성, 48kHz, libopus) | 0.10% |
| 48kHz → 16kHz 바꾸기(LiveKit SDK 리샘플러) | 0.13% |
| 음성 넘기기(우리 파이썬: `audio_chunks` → PCM 쌓기 → STT 전송 · 과금 지표, 네트워크는 가짜) | 0.16% |
| Opus 압축(질문 음성, 48kHz) | 0.83% |
| 답변 끝 분석(1분 답변의 억양 · 말끝 흐림) | 답변 1개에 62ms |
| 사진 base64(1초 1장) | 측정 하한(약 16ms) 미만 |
| **합계** | **약 1.3%** |

면접 1건 실측(12~16%)의 1할이다. 나머지는 실제 방이 있어야 생기는 일(조각을 SDK와 파이썬 사이로 넘기기, WebRTC 처리 등)이라 4장에서 잰다.

## 4. 로컬 측정 2: 실제 방

로컬 LiveKit 방에 지원자 역할(48kHz 음성을 실시간으로 계속 보냄)과 에이전트 역할을 따로 띄우고, 에이전트 쪽을 단계별로 쟀다(`loadtest/agent-audio/room_agent.py`). 단계는 앞 단계에 하나씩 더한다.

| 단계 | 10ms 조각(3회) | 100ms 조각(2회) |
|---|---|---|
| 방 연결만 | 1.2~1.8% | 1.5~2.0% |
| + 지원자 마이크 구독 | 1.5~3.4% | 2.3~3.2% |
| + 16kHz로 음성 조각 받기 | 6.3~7.3% | 2.9~4.4% |
| + 우리 코드(조각 넘기기 · PCM · 지표) | 7.3~10.3% | 4.0~4.7% |
| + STT로 TLS 전송 = **답변 듣는 동안** | **8.5~10.8%** | **3.2~3.4%** |
| **질문 음성 내보내기**(24kHz) | **9.9~14.7%** | **5.0~7.6%** |

- 3장에서 코덱 · 변환은 1% 안팎이었는데, 실제 방에서 "음성 조각 받기"를 더하면 4~6%p 오른다. 오른 몫은 초당 100번 조각을 넘기는 비용이다. 100ms로 키우면 그 몫이 거의 사라진다
- 질문 음성도 10ms 조각을 초당 100번 넣는 구조라 압축 비용(0.8%)보다 훨씬 크다. 100ms로 넣으면 줄어든다
- 같은 조건에서도 회차마다 2~4%p 흔들렸다. 10ms와 100ms의 차이는 매번 같은 방향으로, 그보다 크게 나왔다

## 5. 바꾼 것

| 쪽 | 바꾼 곳 | 전 → 후 | 영향 |
|---|---|---|---|
| 받는 쪽(지원자 음성 → STT) | `ai/app/agent/stt.py` `CHUNK_MS`, `ai/app/agent/main.py` `AudioStream(frame_size_ms=CHUNK_MS)` 두 곳 | 10ms → 100ms | STT로 가는 음성이 최대 0.1초 늦다. 답변 끝은 7초 침묵으로 판단해 영향이 거의 없다 |
| 보내는 쪽(질문 음성) | `ai/app/agent/question.py` `FRAME_MS` | 10ms → 100ms | 마지막 조각을 무음으로 채워 질문 음성 끝이 최대 0.1초 늦다 |

## 6. 개발 서버 변경 전

| 항목 | 값 |
|---|---|
| 대상 | `https://hangguet.yobistory.com`(develop, 10ms 조각) |
| 면접 | 개발자 커피챗, 화상, 질문 5개. 회차마다 2건을 동시에 시작 |
| 입력 | 크롬을 가짜 장치 옵션으로 띄워 `loadtest/media/answer.wav`(답변 5개 + 각 8초 침묵)를 마이크로, `camera.y4m`을 카메라로 쓴다. 에이전트가 7초 침묵에서 답변을 제출한다 |
| 구간 | 에이전트 로그의 면접방 입장 ~ 종료. 면접이 끝난 뒤 처리(녹화 합치기 · 결과 생성)가 돌던 때 찍힌 값은 뺀다 |

| 회차 | 면접(세션) | 구간 | 면접 전 서버 CPU | 면접 중 서버 CPU(30초 값) | 평균 |
|---|---|---|---|---|---|
| 1 | 76 · 77 | 10:21:30~10:23:19 | 약 15.3% | 30.3, 29.3, 30.3 | 30.0% |
| 2 | 78 · 79 | 10:29:07~10:30:58 | 약 15.1% | 24.3, 29.4, 40.9 | 31.5% |

- 두 회차 모두 다른 면접은 없었다(10:15~10:34 AI 작업은 세션 76~81뿐, 에이전트 방은 76~79뿐, develop 배포 없음)
- 뺀 값: 1회차 10:23:30(26.0%, 10:23:18에 면접 77 녹화 합치기 시작), 2회차 10:31:00(58.0%, 10:30:57에 면접 79 녹화 합치기 시작)
- **면접 중에도 같은 서버에서 채점이 돈다.** 답변이 제출될 때마다 `SCORE_ANSWER`가 4~7초씩 돌아, 2회차처럼 한 회차 안에서도 값이 24~41%로 흔들린다. 서버 전체 CPU에는 에이전트 · 채점 · 녹화 · LiveKit이 모두 섞여 있어 에이전트 몫만 따로 볼 수는 없다
- 참고: 같은 날 먼저 직접 말한 짧은 답변으로 잰 회차(세션 74 · 75, 09:56:55~10:01:03)는 면접 전 15.2% → 면접 중 31.9%였다. 입력이 달라 비교에서는 뺀다

## 7. 개발 서버 변경 후

머지 · 배포 뒤 6장과 같은 방법(면접 2건 동시 × 2회)으로 재서 채운다.

## 8. 한계

- 로컬은 윈도우 노트북의 한 프로세스로 잰 값이라 운영(리눅스 컨테이너, 면접마다 프로세스)과 절대값이 다르다. 차이의 방향과 크기를 본다
- 개발 서버는 서버 전체 CPU만 있어 에이전트 몫을 따로 볼 수 없다. 에이전트만 보려면 컨테이너별 CPU(cAdvisor 또는 `docker stats a301-dev-ai-agent`)가 필요하다

## 부록: 다시 재는 법

로컬(레포 루트, Git Bash). LiveKit 서버 · TLS 인증서 · 측정 순서:

```bash
docker run -d --rm --name agent-audio-livekit -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server:v1.13.10 --dev --bind 0.0.0.0 --node-ip 127.0.0.1
mkdir -p loadtest/results/agent-audio && MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -keyout loadtest/results/agent-audio/key.pem -out loadtest/results/agent-audio/cert.pem -days 1 -subj "/CN=localhost"
ai/.venv/Scripts/python.exe loadtest/agent-audio/tls_sink.py &
ai/.venv/Scripts/python.exe loadtest/agent-audio/room_candidate.py 230 &
ai/.venv/Scripts/python.exe loadtest/agent-audio/room_agent.py 10    # 조각 길이(ms). 100과 번갈아 돌린다
ai/.venv/Scripts/python.exe loadtest/agent-audio/parts.py           # 3장(서버 없이)
docker stop agent-audio-livekit
```

개발 서버: 크롬을 모두 끈 뒤(`chrome://quit`) 가짜 장치 옵션으로 다시 켜고(`chrome://version`에서 옵션 확인), 탭 2개에서 면접을 동시에 시작한다. 가짜 미디어 파일은 `loadtest/media/make-media.ps1`로 만든다.

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --use-fake-device-for-media-stream --use-fake-ui-for-media-stream "--use-file-for-fake-audio-capture=C:\jjw\S15P31A301\loadtest\media\answer.wav" "--use-file-for-fake-video-capture=C:\jjw\S15P31A301\loadtest\media\camera.y4m"
```
