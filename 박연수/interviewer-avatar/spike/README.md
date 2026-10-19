# 시험 코드 핵심 발췌

[← 검증 결과](../verification.md)

[verification.md](../verification.md)의 결론을 낸 시험 코드에서 구현 방식을 보여 주는 핵심 파일만 옮겼다. **실행용이 아니며 제품 코드로 복사하지 않는다.** 정식 구현은 브랜치 계획에 따라 feature 브랜치에서 새로 작성한다. 설정·테스트·서버 mock·모델과 그림은 넣지 않았다.

| 파일 | 내용 | 관련 절 |
|---|---|---|
| [reactionEvent.ts](reactionEvent.ts), [reaction-event.schema.json](reaction-event.schema.json) | 반응 이벤트 타입과 JSON Schema 초안 | [architecture.md](../architecture.md) 2장, verification.md 3.3 |
| [EventFilter.ts](EventFilter.ts) | `sequence` 역전·`ttlMs` 만료·"답변 완료" 후 무시, 발화 연계 반응 허용 | verification.md 3.3 |
| [reactionMap.ts](reactionMap.ts) | 논리 표정 → ARKit 모프 표(들을 때 / 말할 때) | verification.md 4·5장 |
| [ExpressionController.ts](ExpressionController.ts) | 태도·순간 표정 보간, 기본값 × 배율 × `intensity`, 최대 0.8. 상태 전환 시 순간 표정 하강(`releaseMomentary`, 10/14) | verification.md 5.1, 9.3 |
| [GestureController.ts](GestureController.ts) | 끄덕임 곡선(`nodBump`, 10/14) | verification.md 9.3 |
| [MouthController.ts](MouthController.ts) | 음량 → 입 벌림, 열림 50ms·닫힘 120ms 보간 | verification.md 4장 |
| [personas.ts](personas.ts) | 페르소나 3종 수치와 2D 그림 설정 | verification.md 5.2 |
| [SpriteAvatar.ts](SpriteAvatar.ts) | 2D 그림 교체 렌더러(10/13 방식): 표정 단계 선택, 눈·입 겹치기, 웃으며 말하는 입 | verification.md 3.4 |
| [bake.mjs](bake.mjs) | 2D 눈·입 그림을 부위 조각으로 만드는 스크립트(10/13 방식) | verification.md 3.4 |
| [warp/warpRenderer.js](warp/warpRenderer.js) | 2D 점 찍어 휘기: 점 위치 계산, 그룹별 그림 섞기 셰이더 | verification.md 9.3 |
| [warp/motion.js](warp/motion.js) | 시간 보간(스프링), 애니메이션 원칙, 말할 때 윗얼굴·입꼬리 동작, 2D 끄덕임 상한 | verification.md 9.3, 9.8 |
| [warp/defringe.mjs](warp/defringe.mjs) | 생성 그림 가장자리 테두리 제거 | verification.md 9.7 |

코드 안의 `@proto/contract`는 `reactionEvent.ts`, `./controllers/…`·`../…` import는 이 폴더에 없는 시험 코드 파일을 가리킨다. `warp/` 파일의 전역 변수(`P`, `masks`, `st`, `sm` 등)는 시험 렌더러 페이지 안의 상태다.

발췌 코드의 반응 이벤트에는 `eventId`·`sessionId`·`turnId`·`sequence`가 들어 있지만, 정식 구현에서는 넣지 않는다(10/19 변경).

- 면접 식별(`sessionId`)과 순서·중복 검사(`sequence`)는 WebSocket 메시지 봉투 값을 쓴다(10/19 변경).
- 메시지 형식은 구현에 따라 바뀔 수 있으므로 적용·구현 시 다시 확인한다. 참고: [API 명세](../../../docs/API-명세.md) 3장
