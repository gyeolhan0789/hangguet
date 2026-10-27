# 내 담당: 시중 서비스 조사

[← 내 담당 문서로 돌아가기](README.md) · [기술 조사](research.md)

> 시중 AI 면접(채용용)과 AI 면접 연습 서비스가 사용자의 언어·비언어 요소를 분석하는지, 무엇을 어떻게 보여 주는지 조사한다.

조사일: 2026-10-12 · 대부분 업체 소개글과 3자 리뷰 기준이다. 세부 산출 방식은 거의 공개되어 있지 않아 **직접 체험해서 확인할 것**을 6장에 정리했다.

## 0. 한눈에 보기

| 구분 | 언어(말투·속도·군말) | 비언어(시선·표정) | 내용 | 결과 형태 |
|---|---|---|---|---|
| 국내 채용용 | 거의 없음 | 일부만, 항목 비공개 | **중심** | 점수 · 등급 · 역량 리포트 |
| 국내 연습용 | 일부 | 대부분 있음 | 있음 | 점수 · 합격 가능성 · 영상 다시보기 |
| 해외 연습용 | **강함** (군말, 속도, 반복어, 톤) | 일부 (눈 맞춤, 몸짓) | 일부 | 지표 + 받아쓰기 위 표시 |

- 언어·비언어·답변 내용을 **"한 장면"으로 묶어 보여 주는 서비스는 찾지 못했다.** 우리 기획의 차별점은 유효하다.
- 채용용은 비언어 분석에서 **빠지는 추세**다(HireVue 표정 분석 중단, 슈퍼코더는 약관에 미사용 명시).

## 1. 국내 채용용 AI 면접 (기업이 지원자를 평가)

| 서비스 (운영사) | 언어 | 비언어 | 비고 |
|---|---|---|---|
| 뷰인터HR (제네시스랩) | 답변 문맥으로 역량 평가(BEI) | **신뢰감, 자연스러움, 침착성, 눈 마주침** 평가 | 100곳 이상 기관 도입이라고 소개 |
| AI역량검사 · 잡다 (마이다스인, 자인원) | 영상 답변을 STT로 받아 요약 | 워크넷 안내: "표정과 음성 등을 종합 분석". 세부 항목 비공개 | 36개 세부 역량, 종합 점수·등급·등수 |
| 하이버프 (블루바이저시스템즈) | 답변 텍스트, 감성 분석 | 영상·음성 분석 언급. 어떤 지표인지 비공개 | 29개 채점 항목. 지원자용 코칭도 있음 |
| 무하유 몬스터 (무하유) | 답변·직무 적합도, 구체성 등 6개 기준 | 태도·의사소통 평가. **시선·머리 움직임은 부정행위 감지용** | |
| 텔타 Interview Pro (클라썸) | 실시간 전사·요약 | 언급 없음 | 면접관 보조 도구 |
| 스펙터 에피 (스펙터) | 음성 → 텍스트 → 내용 분석 | 언급 없음 | |
| 슈퍼코더 AI 면접 (세컨드팀) | 답변 내용(맥락·행동·결과) | **약관상 표정·시선·감정·음성 톤 분석 안 함** | 근거가 된 답변을 함께 표시 |

- 7개 비교 자료에서 **말 속도·군말 같은 발화 방식 분석은 모두 언급이 없었다.**
- 비언어를 쓰는 곳도 "무엇을 어떻게 재는지"는 공개하지 않는다.

### 해외 사례: HireVue의 표정 분석 중단

- HireVue는 영상 면접에서 표정 근육 움직임(찡그림, 미소 등)으로 지원자 특성을 평가했다.
- **2020년 3월에 중단했고 2021년 1월에 발표했다.** 이유는 두 가지였다.
  - 자연어 처리가 발전해 **언어 분석만으로 예측력이 충분**해졌고, 표정 분석이 더하는 가치가 적었다.
  - 대중의 우려가 커서 유지할 이유가 없었다.
- 2019년에는 개인정보 단체가 FTC에 진정을 내기도 했다.

→ **표정으로 성격·역량을 추론하는 것은 피한다.** 기술 조사([research.md](research.md) 2-3)의 "감정 이름 대신 관찰한 사실만" 방향과 맞다.

## 2. 국내 연습용 (개인이 스스로 연습)

| 서비스 | 언어 | 비언어 | 결과 |
|---|---|---|---|
| 뷰인터 (개인·에듀) | 언어·음성 분석 | 표정, 시선, 호감도 | 합격 가능성 점수, 소셜스킬 10개 점수, Big5 성격, 시선·표정·음성 분석, AI 면접위원 채점·보완 피드백, **녹화 영상 다시보기** |
| 에듀스 AI 면접 (INFACE) | 1분 자기소개 평가, 대화형 면접 | 공개 페이지에 항목 없음 | 문항별 답변 가이드·예시, 항목별 결과지 |
| 사람인 AI 면접 연습 | 직무별 역량 키워드 분석 | 3자 비교표에 "있음". 공식 확인 못 함 | AI 피드백 |
| 잡다 모의 응시 | 실제 역량검사와 같은 환경 | 실제 검사와 같다고 추정 | 역량검사 결과표 |
| 면접톡 | | 표정·시선 피드백이 제한적이라는 평가 | |

- 연습용은 대부분 **점수 위주**다(합격 가능성 점수, 소셜스킬 점수). "시선 72점" 같은 피드백이 실제로 많다는 뜻이다.
- 뷰인터의 **녹화 영상 다시보기**는 우리 리포트의 "장면 구간 재생"과 비슷하다. 다만 점수와 장면이 연결되는지는 확인 필요.

## 3. 해외 연습용

| 서비스 | 언어 | 비언어 | 보여 주는 방식 |
|---|---|---|---|
| **Yoodli** | 군말(um, ah), 반복어, 약한 말("totally", "really"), 자주 쓴 단어, 분당 단어 수, 쉼 제안 | 웹캠으로 눈 맞춤, 화면 중앙 위치 | **받아쓰기에서 군말 위치 표시**, 세션 후 스코어카드. Toastmasters 공식 파트너(2022.12) |
| Huru | 속도, 군말 | 몸짓 | 영상 다시보기와 함께 전달 피드백. 공고 붙여 넣으면 맞춤 질문 |
| Microsoft Speaker Coach (PowerPoint) | 속도, **단조로운 음높이**, 군말, 구어체, 반복어 | 몸짓·자세·눈 맞춤 (선택) | 연습 중 화면 안내 + 연습 후 리포트 |
| Google Interview Warmup | 직무 관련 단어, **3번 이상 쓴 단어**, 다룬 주제(경험·역량·교훈) | 없음 | **채점하지 않음**. "패턴을 보여 줄 뿐 맞고 틀림을 말하지 않는다". 음성 저장 안 함 |
| Final Round AI | | 확인 못 함 | 실제 면접 중 실시간 보조가 중심 (윤리 논란) |
| Big Interview | | 확인 못 함 | 강의·이력서 등 종합 학습 |

- 해외 연습용은 **언어 분석(군말·속도·반복어)이 강하다.** 모두 영어 기준이다.
- Yoodli의 "받아쓰기 위에 군말 위치 표시"가 우리 "장면 단위 피드백"에 가장 가깝다. 다만 비언어와 답변 내용까지 한 장면에 묶지는 않는다.
- Google은 일부러 채점하지 않는다. 우리도 "단정 대신 관찰 + 제안"으로 가면 비슷한 철학이 된다.

## 4. 오픈소스 참고: ki-ders/interview-coach

한국어 AI 모의면접 코치 웹앱이다. 측정 지표와 계산 방식이 공개되어 있어 **바로 참고할 수 있다.**

| 항목 | 입력 | 계산 |
|---|---|---|
| 시선 | 얼굴 랜드마크, 눈 블렌드셰이프 | 보정값 기준 **정면 응시 비율(60~93%를 이상적으로 봄)**, 아래 보기, 시선 흔들림, 깜빡임 |
| 몸짓 | 포즈 랜드마크 | 어깨 기울기, 움츠림, 상체 흔들림, 손동작 양(너무 적어도 감점), 얼굴 만지기 |
| 말투·전달 | 마이크 타이밍, 받아쓰기 | **긴 침묵에 가장 큰 비중**, 발화 비율, 음절/초, 간투사, 더듬음, 문장 마무리 |
| 발성 | 마이크 음량 | 배경 소음 대비 크기, 작게 말한 비율, 음량 기복, 말끝 흐림 |
| 안정감 | 무릎·골반 위치 | 2.5~9Hz 진동을 다리 떨기로 판정 |
| 답변 내용 | 받아쓰기 | 질문 키워드 매칭, 사례·수치·구조. 선택 시 LLM 평가 |

- 구조: **서버 없이 브라우저에서 처리**한다(MediaPipe + Web Speech API + Web Audio API). 우리 기술 조사의 브라우저 처리 방향과 같다.
- 차이: 음성 인식에 Web Speech API(Chrome 한정)를 쓴다. 우리는 RTZR로 군말과 단어 시각을 받는다.
- 정면 응시 60~93%, 다리 떨기 2.5~9Hz 같은 **기준값 출처는 확인 필요**. 그대로 쓰지 말고 출발점으로만 쓴다.

## 5. 우리 기획에 주는 시사점

| 시중 상황 | 우리 방향 |
|---|---|
| 대부분 점수·등급 위주 (합격 가능성, 소셜스킬 점수) | **장면 단위**: 어느 순간, 무엇이, 왜. 해당 구간 영상 재생 |
| 언어·비언어·내용을 따로 보여 줌 | 같은 시간축 이벤트로 **한 장면에 묶기** (다빈 님 채점 결과와 `question_id`로 연결) |
| 산출 방식 비공개 | 근거 공개: 시각, 수치, 받아쓰기 원문 |
| 표정으로 성격·호감도 추론 (HireVue는 중단) | 감정·성격 추론 안 함. 관찰한 사실만 |
| 군말·속도 분석은 해외(영어) 위주, 국내 채용용은 없음 | **한국어 군말·속도**는 빈 자리. RTZR 군말 보존으로 공략 |
| 공통으로 보는 항목: 속도, 군말, 눈 맞춤, 단조로운 톤, 반복어 | MVP 후보(속도, 긴 쉼, 군말, 시선 회피)가 시장 기본기와 일치 |

## 6. 직접 확인할 것

- [ ] 뷰인터 무료 연습 → 리포트 캡처 (점수와 영상 구간이 연결되는지)
- [ ] 잡다 모의 응시 → 영상 면접 결과표 항목 확인
- [ ] 사람인 AI 면접 연습 → 비언어 피드백 실제 항목 확인
- [ ] Yoodli 무료 체험 → 군말 표시 방식, 눈 맞춤 리포트 형태 확인 (한국어 지원 여부 포함)
- [ ] interview-coach 기준값(정면 응시 60~93% 등) 출처 확인

## 출처

- 국내 비교: [국내 AI 면접 서비스 7개 비교 (슈퍼코더 블로그, 자사 서비스 포함)](https://www.supercoder.co/blog/korean-ai-interview-services-deep-dive) · [AI 모의면접 무료 사이트 정리 (AceRound)](https://www.aceround.app/ko/blog/ai-mock-interview-free-korea/)
- 뷰인터: [모켓 도구 소개](https://www.moket.kr/tools/viewinter) · [링커리어 뷰인터 준비법](https://community.linkareer.com/employment_data/4980956) · [한경 체험 기사](https://magazine.hankyung.com/business/article/202303303411b) · [위키독스](https://wikidocs.net/128261)
- 잡다·AI역량검사: [워크넷 면접 가이드](https://work.go.kr/empSpt/empGuide/empTrend/interviewGuide.do) · [AI 역량검사 대비법 (위키독스 블로그)](https://wikidocs.net/blog/@openwiki/24381/) · [전자신문 (2020)](https://m.etnews.com/20200324000210)
- 에듀스: [INFACE AI 면접 연습](https://inface.ai/educe/ainterview/study)
- HireVue: [SHRM](https://www.shrm.org/in/topics-tools/news/talent-acquisition/hirevue-discontinues-facial-analysis-screening) · [Staffing Industry Analysts](https://www.staffingindustry.com/news/global-daily-news/hirevue-announces-visual-analysis-no-longer-part-software-amid-natural)
- Yoodli: [Toastmasters 소개](https://toastmasters.org/magazine/magazine-issues/2023/jan/introducing-yoodli) · [Yoodli 군말 블로그](https://app.yoodli.ai/blog/how-to-stop-using-filler-words)
- Huru: [Final Round AI vs Huru (경쟁사 작성)](https://www.finalroundai.com/compare/final-round-ai-vs-huru) · [Huru 리뷰](https://www.finalroundai.com/blog/huru-review-pros-cons)
- Big Interview·Final Round AI: [AI 면접 준비 도구 순위](https://theairankings.com/best-ai-interview-prep/)
- Microsoft: [Speaker Coach 제안 항목](https://support.microsoft.com/en-us/powerpoint/suggestions-from-speaker-coach) · [Speaker Coach 연습 안내](https://support.microsoft.com/en-us/topic/cd7fc941-5c3b-498c-a225-83ef3f64f07b) · [Microsoft Education 블로그](https://www.microsoft.com/en-us/education/blog/?p=2092)
- Google: [Interview Warmup](https://grow.google/interview-warmup) · [9to5Google](https://9to5google.com/2022/05/17/google-interview-warmup/)
- 오픈소스: [ki-ders/interview-coach](https://github.com/ki-ders/interview-coach)
