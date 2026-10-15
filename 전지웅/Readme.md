# 개인 학습 기록 — 전지웅

> 담당: 면접관 반응 로직 · 기록 기간: 2026.10.12 ~
>
> 구현 방안 문서: [면접관_반응_구현방안.md](docs/면접관_반응_구현방안.md)
>
> STT 모델 테스트: [STT_모델_테스트.md](docs/STT_모델_테스트.md)

---

### 📅 2026-10-14 (수)

**오늘 한 것**
- 립싱크 테스트 페이지에 면접관 고갯짓·표정 추가 (말할 때 끄덕임, 질문 끝에 고개 기울임, 옅은 미소, 눈 깜빡임)
- UI 디자인(S06)과 비교 → 핵심은 답변을 듣는 동안의 반응(끄덕임·갸웃·표정)
- 면접관 아바타 후보 조사

  | 후보 | 장점 | 걸리는 점 |
  |---|---|---|
  | [CGTrader 카툰 남성](https://www.cgtrader.com/3d-models/character/man/customizable-man-cartoon-character-in-blender) ($24) | 디자인 화풍과 비슷, 표정 52종 | 웹용 변환·경량화 필요, 웹 사용 허용 확인 |
  | [CGTrader tomnook3d](https://www.cgtrader.com/3d-models?author=tomnook3d&low_poly=1&optimized=1&rigged=1&sort_by=sales) ($32) | 실사풍, 표정 52종 | 웹용 파일 없음, 무거움, 화풍 다름 |
  | [VTubeMe 무료 VRM](https://vtubeme.com/free-vrm-avatars) | 무료 | 대부분 화풍 다름 |
  | ~~[AI STUDIOS](https://www.aistudios.com/ko/ai-avatars)~~ | 실사 품질 | mp4 영상을 받는 방식이라 실시간 반응 불가 → 제외 |

- TTS 타이밍 비교, Redis 사용 범위 검토

**배운 것 / 정리**
- **TTS 타이밍**: Typecast·ElevenLabs는 글자별 시간을 줘서 모음에 맞는 입 모양 가능. Chirp 3: HD는 소리 크기로만 입을 여닫음
- **Redis**: 잠깐 쓰는 데이터만 저장(진행 중 면접 상태, 분석 대기열, 로그인 토큰 등). 오래 남길 기록은 Postgres, 음성은 Storage. 아바타 방식과는 무관

**막힌 것 & 해결**
| 문제 | 원인 | 해결 |
|---|---|---|
| Crowley는 눈썹·눈동자를 움직일 수 없음 | 모델에 해당 표정이 없음 | 표정 52종 모델 후보 조사 |
| 아바타 방식(2D·3D 구입·제작·무료) 미정 | 방식마다 표현력·화풍·비용이 다름 | 2D와 3D를 짧게 만들어 비교 예정 |

**내일 할 것**
- [ ] 조사 결과를 표현 모듈 담당과 공유
- [ ] 구입 후보 판매자에게 웹 사용 가능 여부 문의
- [ ] 테스트 페이지에 듣는 동안의 반응 추가

**참고 링크**
- [ElevenLabs 타임스탬프 TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)

---

### 📅 2026-10-13 (화)

**오늘 한 것**
- STT 모델별 테스트 (S15P31A301-51): RTZR `sommers_ko`·`whisper`, Soniox `stt-rt-v5` 비교 → Soniox 선정
  - 결과 문서: [STT_모델_테스트.md](docs/STT_모델_테스트.md)
- Soniox 컨텍스트 사전 작성 (S15P31A301-52): [soniox-context.json](docs/soniox-context.json)
- 면접관 3D 모델 조사 → CC0 VRM 모델 [Crowley](https://vtubeme.com/free-vrm-avatars/cc0/crowley) 선정
- Typecast 타임스탬프 + Crowley(three-vrm)로 립싱크 테스트 페이지 제작

**배운 것 / 정리**
- **STT 비교**: RTZR는 언어 1개만 지정, 키워드 100개·한글 발음만 가능 → 기술 용어가 어색한 한글로 바뀜. Soniox는 언어 여러 개 지정, 용어를 원래 표기로 넣을 수 있음
- **Soniox 컨텍스트**: `general`에는 분야·상황·주제만 넣음(언어 지시를 넣으면 역효과). `terms`는 실제로 말하는 방식대로 한국어·영어 표기를 넣음
- **VRM**: 표정·입 모양은 표준 이름(`aa`·`ih`·`ou`·`ee`·`oh`, `happy` 등)으로 제공, 제스처는 없어서 뼈를 코드로 회전. 모델마다 라이선스 확인 필요
- **립싱크**: Typecast가 주는 글자별 시간에서 한글 모음을 뽑아 입 모양으로 변환

**막힌 것 & 해결**
| 문제 | 원인 | 해결 |
|---|---|---|
| 영어 기술 용어가 어색한 한국어로 인식됨 | `general`의 언어 지시 | 언어 지시 제거, 용어 목록 재구성 |
| 무료 악마 3D 모델에 얼굴 표정이 없음 | 대부분 몸 뼈대만 있는 게임용 모델 | 표정·립싱크가 있는 CC0 VRM 모델 사용 |
| Chirp 3: HD로 립싱크 타이밍을 맞출 수 없음 | 타이밍용 SSML `<mark>` 미지원 | 타임스탬프를 주는 Typecast로 테스트 |

**내일 할 것**
- [ ] 립싱크 싱크·입 벌림 강도 조정
- [ ] 면접관 표현 모듈에 Crowley·Typecast 결과 공유 (TTS 변경 협의)
- [ ] Soniox 컨텍스트 사전 다듬기

**참고 링크**
- [Soniox Context 문서](https://soniox.com/docs/stt/concepts/context)
- [Typecast 타임스탬프 TTS API](https://typecast.ai/docs/ko/api-reference/text-to-speech/text-to-speech-with-timestamps)

---

### 📅 2026-10-12 (월)

**오늘 한 것**
- 실시간 STT 서비스 조사·비교 (방식·속도·비용) → 이 시점에는 RTZR로 결정
- 면접관 반응에 쓸 Jev 조사 (공식 문서, 외부 측정 자료)
- 면접관 반응 구현 방안 문서 작성: [면접관_반응_구현방안.md](docs/면접관_반응_구현방안.md)

**배운 것 / 정리**
- **STT 방식**: 녹음 파일 전송(Whisper)은 답변이 끝나야 글자가 나옴 → 답변 중 반응하려면 스트리밍 방식 필요
- **문장 끝 판단**: 한국어는 문장 끝에서 뜻이 정해지므로 반응은 문장이 끝난 뒤에 냄. 말끝·문장부호·0.3초 멈춤으로 판단
- **Jev**: 보기 선택·점수와 확신도를 반환, 응답 약 0.3초. Jev는 면접관의 속마음만 판단하고 표정은 코드에서 결정
- **반응 구분**: 듣는 동안의 태도 / 쉴 때의 맞장구 / 문장 끝의 반응 / 끼어들기

**막힌 것 & 해결**
| 문제 | 원인 | 해결 |
|---|---|---|
| 반응 계획이 Jev 특성과 맞지 않음 | Jev를 확인하지 않고 계획부터 세움 | 공식 문서와 외부 측정 자료로 재조사 후 수정 |
| STT 비용이 실제와 다르게 계산됨 | 스트리밍인데 파일 전송처럼 계산 | 면접 시간(회당 30분) 기준으로 재계산 |

**내일 할 것**
- [ ] STT 서비스별 정확도·지연 시간 테스트
- [ ] Jev 한국어 판단 정확도 테스트

**참고 링크**
- [RTZR 스트리밍 STT 문서](https://developers.rtzr.ai/docs/stt-streaming/)

---

<!-- ↓ 이 블록을 복사해서 위(최신 날짜가 위)에 추가하세요 ↓
### 📅 2026-__-__ (_)

**오늘 한 것**
-

**배운 것 / 정리**
-

**막힌 것 & 해결**
| 문제 | 원인 | 해결 |
|---|---|---|
| | | |

**내일 할 것**
- [ ]

**참고 링크**
-

---
-->
