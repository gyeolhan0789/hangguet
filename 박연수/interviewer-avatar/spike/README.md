# 시험 코드 핵심 발췌

[← 검증 결과](../verification.md)

[verification.md](../verification.md)의 결론을 낸 시험 코드에서 구현 방식을 보여 주는 핵심 파일만 옮겼다. **실행용이 아니며 제품 코드로 복사하지 않는다.** 정식 구현은 브랜치 계획에 따라 feature 브랜치에서 새로 작성한다. 설정·테스트·서버 mock·모델과 그림은 넣지 않았다.

| 파일 | 내용 | 관련 절 |
|---|---|---|
| [reactionEvent.ts](reactionEvent.ts), [reaction-event.schema.json](reaction-event.schema.json) | 반응 이벤트 타입과 JSON Schema 초안 | [architecture.md](../architecture.md) 2장, verification.md 3.3 |
| [EventFilter.ts](EventFilter.ts) | `sequence` 역전·`ttlMs` 만료·"답변 완료" 후 무시, 발화 연계 반응 허용 | verification.md 3.3 |
| [reactionMap.ts](reactionMap.ts) | 논리 표정 → ARKit 모프 표(들을 때 / 말할 때) | verification.md 4·5장 |
| [ExpressionController.ts](ExpressionController.ts) | 태도·순간 표정 보간, 기본값 × 배율 × `intensity`, 최대 0.8 | verification.md 5.1 |
| [MouthController.ts](MouthController.ts) | 음량 → 입 벌림, 열림 50ms·닫힘 120ms 보간 | verification.md 4장 |
| [personas.ts](personas.ts) | 페르소나 3종 수치와 2D 그림 설정 | verification.md 5.2 |
| [SpriteAvatar.ts](SpriteAvatar.ts) | 2D 렌더러: 표정 단계 선택, 눈·입 겹치기, 웃으며 말하는 입 | verification.md 3.4 |
| [bake.mjs](bake.mjs) | 2D 눈·입 그림을 부위 조각으로 만드는 스크립트 | verification.md 3.4 |

코드 안의 `@proto/contract`는 `reactionEvent.ts`, `./controllers/…`·`../…` import는 이 폴더에 없는 시험 코드 파일을 가리킨다.
