# 면접관 표현 모듈: 아키텍처

[← 개요](overview.md) · [결정 사항](decisions.md)

원칙: **3D 렌더링이 실패해도 면접은 끝까지 진행된다.**
반응 이벤트 형식을 MVP 단계에서 고정하여, 이후 모델이나 립싱크 방식을 변경해도 타 모듈에 영향이 없도록 한다.

## 1. MVP 구조

면접관 표현 모듈의 구성 요소는 Client(브라우저)에서 동작한다. TTS는 BE의 요청을 받아 AI 파트(면접 AI 모듈)가 호출하고, Client는 BE가 발급한 읽기용 Presigned URL로 음성을 받아 재생한다.

![MVP 아키텍처](images/mvp-architecture.png)

```
[FE]            질문 요청
      ↓
[BE]            면접 AI 모듈에 질문 생성·TTS 요청 (업로드용 Presigned URL 포함)
      ↓
[면접 AI 서버]  질문 생성 → GMS TTS 호출 → 업로드용 Presigned URL로 음성 파일을 Storage에 업로드
      ↓ 완료 응답
[BE]            읽기용 Presigned URL 발급 → 질문 Text + 읽기용 URL 전달
      ↓
[음성 재생 · 립싱크]  Storage에서 음성 로드, Web Audio, 음량 → 입 벌림 0~1
      ↓
[면접관 Renderer]  VRM + Three.js  ← 반응 이벤트 (반응 로직 모듈)
      ↓ 실패 시
[정지 화면]
```

TTS 호출과 음성 전달 구조는 [CONTRIBUTING.md](../../docs/CONTRIBUTING.md)를 따른다.

| 구조 | CONTRIBUTING.md 근거 |
|---|---|
| FE는 GMS와 면접 AI 모듈을 직접 호출하지 않고 BE에 요청한다 | 6.1 "GMS·STT Provider·내부 AI Service를 직접 호출하지 않는다" |
| FE는 GMS Credential을 보유하지 않는다 | 7장 "FE에서 GMS·STT Provider Credential을 보유하지 않는다" |
| TTS 호출은 AI 파트, AI 요청과 Storage는 BE 파트가 담당한다 | 2.2 Part 표 (`ai`: STT/TTS Adapter, `be`: AI Job·Storage) |
| 음성 파일은 BE를 거치지 않고 Storage로 직접 올리고 받는다 | 7장 "음성 Binary를 WebSocket Payload로 전송하지 않는다", "BE Application Body로 중계하지 않는다" |
| Presigned URL은 BE가 발급하고 소유권·만료를 검증한다 | 6.2 "Presigned URL의 사용자·Object 소유권과 만료를 검증한다" |
| TTS 실패·Timeout 시에도 질문 Text는 전달된다 | 6.2 "AI Timeout·실패·재시도·Dead Letter와 사용자 상태가 일치한다" |

| 구성 요소 | 선정 기술 | 선정 사유 |
|---|---|---|
| 3D 렌더링 | Three.js + VRM | 브라우저에서 별도 설치 없이 동작, 표정·입 모양 표준 제공 |
| 음성 합성 | GMS TTS (AI 파트 호출) | 교보재로 제공, Credential은 AI 파트에서만 관리 |
| 음성 전달 | Storage Presigned URL (BE 발급) | 음성 Binary 중계 금지, 만료 시간 적용 |
| 립싱크 | Web Audio API | 별도 라이브러리 없이 음량 측정 가능 |

## 2. 반응 이벤트 (반응 로직 모듈 → 면접관 표현 모듈)

```ts
type ReactionEvent =
  | { type: 'state'; state: 'idle' | 'listening' | 'thinking' | 'speaking' }
  | { type: 'expression'; expression: 'neutral' | 'attentive' }
  | { type: 'gesture'; gesture: 'small_nod' };
```

정의된 값만 처리하며, 정의되지 않은 값은 무시하고 현재 상태를 유지한다.

## 3. 고도화 로드맵

| 단계 | 추가 기능 | 변경 범위 | 결과물 |
|---|---|---|---|
| MVP | 1장 구조 | — | 발화·경청·생각 상태를 표현하는 3D 면접관 |
| 고도화 1 | 모음별 입 모양(Viseme), 표정 5종·제스처 4종 | 립싱크·동작 | 입 모양·표정 자연스러움 향상 |
| 고도화 2 | 2D 캐릭터(Live2D) 대체 화면, 성능·자연스러움 A/B 비교 | Renderer 추가 | 저사양 기기 대응 |

반응 이벤트 형식은 전 단계에서 유지하며, 표정·제스처는 값만 추가한다.

## 4. 협의 필요 사항

1. 반응 이벤트 형식 (반응 로직 모듈)
2. 질문 Text 길이 상한 (면접 AI 모듈): 길이가 짧을수록 TTS 지연이 줄고 자연스럽다
3. 면접관 표시 크기·위치, 대상 노트북 사양 (UI)
4. 질문 Text·읽기용 Presigned URL 전달 형식, URL 만료 시간, TTS 실패 시 응답 형식 (BE, 면접 AI 모듈): WebSocket으로 전달하는 경우 REST 조회로 복구할 수 있어야 한다 ([CONTRIBUTING.md](../../docs/CONTRIBUTING.md) 7장)
