# 면접관 표현 모듈: 아키텍처

[← 개요](overview.md) · [결정 사항](decisions.md)

원칙: **면접관 렌더링이 실패해도 면접은 끝까지 진행된다.**
반응 이벤트 형식을 MVP 단계에서 고정하여, 이후 모델이나 립싱크 방식을 변경해도 타 모듈에 영향이 없도록 한다.

## 1. MVP 구조

면접관 표현 모듈의 구성 요소는 Client(브라우저)에서 동작한다. TTS는 BE의 요청을 받아 AI 파트(면접 AI 모듈)가 호출하고, Client는 BE가 발급한 읽기용 Presigned URL로 음성을 받아 재생한다.

![MVP 아키텍처](images/mvp-architecture.png)

```
[FE]            질문 요청
      ↓
[BE]            면접 AI 모듈에 질문 생성·TTS 요청 (업로드용 Presigned URL 포함)
      ↓
[면접 AI 서버]  질문 생성 → TTS(Chirp 3: HD) 호출 → 업로드용 Presigned URL로 음성 파일을 Storage에 업로드
      ↓ 완료 응답
[BE]            읽기용 Presigned URL 발급 → 질문 Text + 읽기용 URL 전달
      ↓
[음성 재생 · 립싱크]  Storage에서 음성 로드, Web Audio, 음량 → 입 벌림 0~1
      ↓
[면접관 Renderer]  3D: GLB + Three.js / 2D: 표정 그림  ← 반응 이벤트 (BE WebSocket, 쉴 때 끄덕임은 FE 로컬)
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
| 3D 렌더링 | Three.js 0.180.0 + GLB (자체 컨트롤러) | 브라우저에서 별도 설치 없이 동작, ARKit 표정 52종으로 눈·눈썹·입을 따로 제어 |
| 2D 렌더링 | 표정 그림 바꿔 끼우기 (DOM) | WebGL 없이 동작, 그림 그대로의 화풍 유지 |
| 음성 합성 | Chirp 3: HD (AI 파트 호출) | 한국어 지원, 음성 데이터 반환, Credential은 AI 파트에서만 관리 |
| 음성 전달 | Storage Presigned URL (BE 발급) | 음성 Binary 중계 금지, 만료 시간 적용 |
| 립싱크 | Web Audio API, 음량 → `jawOpen` | 별도 라이브러리 없이 음량 측정 가능, 한국어에서 가장 안정적 |

## 2. 반응 이벤트 (반응 로직 모듈 → BE → 면접관 표현 모듈)

반응 판단은 AI가 하고 BE가 WebSocket으로 전달한다. 쉴 때 끄덕임만 FE 안에서 바로 발생한다(`source: 'local'`). 서버를 거치면 늦어져 맞장구 의미가 없기 때문이며, 브라우저가 마이크 음량만 보고 판단해 외부 서비스 호출·Credential·음성 전송이 없다([CONTRIBUTING.md](../../docs/CONTRIBUTING.md) 6.1, 7장). 마이크 권한이 없거나 채팅 모드이면 발생하지 않고 면접 진행에는 영향이 없다. 서버와 FE가 함께 쓰는 계약이므로 [CONTRIBUTING.md](../../docs/CONTRIBUTING.md) 3.1절에 따라 `common` 브랜치에서 먼저 정의한다. 아래는 시험 코드로 검증한 초안이다([spike/reactionEvent.ts](spike/reactionEvent.ts), [Schema](spike/reaction-event.schema.json)).

```ts
interface ReactionEventBase {
  sequence: number;       // 출처별 단조 증가. 마지막 처리값 이하이면 무시
  ttlMs: number;          // 상대 만료. 받은 시각 + ttlMs가 지나면 무시
  source: 'local' | 'server';
  intensity?: number;     // 0~1, 기본 1. 최종값 = 기본값 × 페르소나 배율 × intensity (최대 0.8)
  utteranceId?: string;   // 발화 연계 반응: 해당 발화가 stop 되면 함께 취소
  offsetMs?: number;      // 발화 시작 기준 지연. 실행 시점에 만료 다시 확인
  durationMs?: number;    // 순간 표정 유지 시간, 갸웃 전체 길이
}

type ReactionEvent = ReactionEventBase & (
  | { type: 'state'; state: 'idle' | 'listening' | 'thinking' | 'speaking' }
  | { type: 'attitude'; interest: number; trust: number; tension: number }  // 0~1 연속값
  | { type: 'expression'; expression: 'smile' | 'frown' | 'smirk' }
  | { type: 'gesture'; gesture: 'small_nod' | 'nod' | 'tilt' }
);
```

- 정의된 값만 처리하며, 정의되지 않은 값은 무시하고 현재 상태를 유지한다.
- 서버 시각(`expiresAt`) 대신 상대 시간(`ttlMs`)을 쓰는 이유는 서버와 사용자 PC의 시계 차이 때문이다.
- "답변 완료" 이후 도착한 이벤트는 버린다.

`common` 계약으로 옮길 때 반영할 것([CONTRIBUTING.md](../../docs/CONTRIBUTING.md)):

- 12.3 Naming: WebSocket 메시지 종류(`kind`)는 Event Type이므로 지금의 `reaction`, `listening_started`, `answer_completed`를 `REACTION`, `LISTENING_STARTED`, `ANSWER_COMPLETED`처럼 UPPER_SNAKE_CASE로 바꾼다. 이벤트 안의 `type`·`state` 값은 필드 값이라 그대로 둔다.
- 6.5 Common: 예시에 지금 있는 정상·미정의·순서 역전·만료·범위 초과 외에 **중복**(같은 `sequence` 재전송)과 **Timeout**(BE→FE 전달 지연으로 `ttlMs` 초과) 예시를 추가한다.

## 3. 고도화 로드맵

| 단계 | 추가 기능 | 변경 범위 | 결과물 |
|---|---|---|---|
| MVP | 1장 구조, 페르소나 3종(3D 2종 + 2D 1종) | — | 발화·경청·생각 상태와 반응을 표현하는 면접관 |
| 고도화 1 | 모음별 입 모양(HeadAudio 한국어 학습 또는 Azure Viseme), 굳음·기다림 표정, 끼어들기, 문장 단위 음성 스트리밍 | 립싱크·동작·음성 | 입 모양·표정 자연스러움 향상, 첫 소리 지연 감소 |
| 고도화 2 | 2D "점 찍어 휘기"(그린 표정 사이 아무 강도·섞은 표정), 실사 면접관, 화풍이 다른 캐릭터에 같은 표정 체계 적용 | Renderer | 표정 표현력 향상, 페르소나 추가 비용 감소 |

반응 이벤트 형식은 전 단계에서 유지하며, 표정·제스처는 값만 추가한다.

## 4. 협의 필요 사항

1. 반응 이벤트 계약 확정, `smirk` 추가, 페르소나별 반응 빈도 기준 (반응 로직 모듈, `common`)
2. 질문 Text 길이 상한 (면접 AI 모듈): 길이가 짧을수록 TTS 지연이 줄고 자연스럽다
3. 페르소나별 배경 이미지, 화면 배치, 시작 클릭 시 오디오 활성화 (UI)
4. 질문 Text·읽기용 Presigned URL 전달 형식, URL 만료 시간, TTS 실패 시 응답 형식 (BE, 면접 AI 모듈): WebSocket으로 전달하는 경우 REST 조회로 복구할 수 있어야 한다 ([CONTRIBUTING.md](../../docs/CONTRIBUTING.md) 7장)
5. 면접관 얼굴 위치 기준, MediaPipe 동시 실행 성능 (피드백 모듈)
