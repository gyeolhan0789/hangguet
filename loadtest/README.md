# 부하 테스트 (k6)

기준 문서는 [부하 테스트 계획](../이해준/load_test_plan/README.md)이다. 부하는 운영 서버가 아니라 **테스트 서버**(`https://lt.hangguet.co.kr`, [server/](server/README.md))에 보낸다.

## 폴더

| 경로 | 내용 |
|---|---|
| `run.sh` | k6 실행. k6가 없으면 Docker 이미지(`grafana/k6:2.3.0`)로 돌린다. `.env.k6` 값을 `-e`로 넘긴다 |
| `lib/` | 공통 모듈: 설정(`config.js`), BE API · FE 페이지 호출(`api.js`), 가입 · 로그인(`auth.js`), 지원서 · 면접(`interview.js`), 계정 목록(`accounts.js`), 지어낸 지원서 · 답변(`data.js`) |
| `seed/seed.js` | 테스트 계정 · 지원서 만들기 → `seed/accounts.json`(커밋하지 않는다) |
| `seed/interviews-browser.js` | 계정마다 끝낸 화상 면접 만들기(실제 화면). S1의 기록 · 결과 · 다시보기 화면이 실제 데이터를 그리게 한다 |
| `lib/browser-interview.js` | 실제 화면으로 화상 면접 1건을 끝까지 진행하는 흐름(S0 · 데이터 만들기 · S5가 같이 쓴다) |
| `scenarios/` | 시나리오(계획 6장). 지금은 S0(`s0-smoke.js` · `s0-browser.js`) · S1(`s1-web-mix.js`) |
| `media/make-media.ps1` | 브라우저 시나리오의 가짜 마이크 · 카메라 파일(`answer.wav` · `camera.y4m`, 커밋하지 않는다) |
| `server/` | 테스트 서버 구성 · 접속 스크립트 |
| `report/` | 회차별 결과 보고서(`<시나리오>-<날짜>.md`). 예: [S0](report/s0-2026-11-02.md) |
| `results/` | k6 원본 출력 · 실패 화면 캡처(커밋하지 않는다) |

## 처음 한 번

1. `loadtest/.env.k6`를 만든다(커밋하지 않는다). 비밀번호는 테스트 계정 공통 값이고 테스트 서버 DB에만 있다

   ```
   BASE_URL=https://lt.hangguet.co.kr
   LOADTEST_PASSWORD=<영문 · 숫자 섞어 8자 이상>
   ```

2. 테스트 계정 · 지원서를 만든다. 다시 돌려도 이미 있는 계정은 그대로 쓴다

   ```bash
   COUNT=1 bash loadtest/run.sh seed/seed.js
   ```

3. 브라우저 시나리오를 돌릴 거면 가짜 미디어 파일을 만든다(Windows, 한국어 음성 필요)

   ```powershell
   .\loadtest\media\make-media.ps1
   ```

## S0 스모크 · 보정 (계획 6장, 실제 외부 API)

| 스크립트 | 하는 일 | 재는 것 |
|---|---|---|
| `s0-smoke.js` | 로그인 → 홈 → 지원서 저장 → 질문 준비 → 면접 시작 → 바로 끝내기(답변 0개 → `ABORTED`) | `application_create_seconds`(Jev), `plan_ready_seconds`(GMS PLAN), `start_seconds` |
| `s0-browser.js` | 실제 화면으로 화상 면접을 끝까지 진행 → 결과 · 다시보기 | 질문 전환 · 채점(GMS) · 녹화 합치기 시간 |

```bash
N=1 bash loadtest/run.sh scenarios/s0-smoke.js
```
```bash
bash loadtest/run.sh scenarios/s0-browser.js
```

- 브라우저 시나리오는 `grafana/k6:2.3.0-with-browser` 이미지와 가짜 카메라 · 마이크(`media/`)를 쓴다. 실패하면 그 단계 화면을 `results/s0-browser-<단계>.png`로 남긴다
- 첫 질문이 나올 때 `answer.wav`가 이미 재생 중이라 첫 답변은 문장 중간부터 인식될 수 있다(진행에는 영향 없음)

`s0-smoke.js`가 면접을 진행하지 않는 이유: 채팅 면접도 질문은 에이전트가 면접방(LiveKit)에서 내고, 에이전트는 사용자가 방에 들어올 때까지 기다린다. k6 HTTP는 방에 들어갈 수 없으므로 면접 진행은 브라우저로 본다.

## S1 웹 · API 혼합 (계획 6장, 외부 API 없음)

면접 없이 화면을 둘러보는 요청만 초당 수를 정해 올린다. 화면은 FE 페이지로 보내고(70%는 화면 이동과 같은 RSC 요청), 비율은 홈 25 · 기록 20 · 결과 20 · 마이페이지 15 · 성장 리뷰 10 · 다시보기 10(%)이다.

먼저 끝낸 면접이 있는 계정을 만든다(빈 계정이면 화면이 실제보다 가볍다). 계정 1은 S0로 이미 있으면 2부터 만든다.

```bash
COUNT=4 bash loadtest/run.sh seed/seed.js
COUNT=3 PER_ACCOUNT=3 ACCOUNT_OFFSET=1 bash loadtest/run.sh seed/interviews-browser.js
```

```bash
RATES=5 HOLD=2m RAMP=30s bash loadtest/run.sh scenarios/s1-web-mix.js   # 짧게 확인
bash loadtest/run.sh scenarios/s1-web-mix.js                            # 본 회차: 5 → 30 → 60 req/s, 단계마다 10분
```

- 결과는 단계(`stage` 태그: `5rps` · `30rps` …)마다 p95 · 실패율이 따로 나온다. 서버 쪽은 같은 구간을 `server/resources.sh`와 Grafana로 본다
- 실패율이 5%를 1분 넘게 넘으면 멈춘다(그 위는 실패만 늘어난다)
- Next.js는 RSC 요청 주소에 `_rsc` 쿼리가 없으면 307로 다시 보낸다. `lib/api.js`의 `page()`가 붙인다

## S5 동시 화상 면접 (계획 6장, 실제 외부 API)

계정마다 실제 화면으로 화상 면접 1건씩을 거의 동시에(`STAGGER`초 간격) 진행한다. 계정이 동시 면접 수만큼 필요하다.

```bash
COUNT=10 bash loadtest/run.sh seed/seed.js
bash loadtest/s5-levels.sh                                  # 동시 1 · 3 · 5 · 8 · 10건, 단계 사이 2분 쉼
N=3 bash loadtest/run.sh scenarios/s5-interview-browser.js  # 한 단계만
```

- `s5-levels.sh`는 단계마다 k6 출력(`results/s5-N<단계>.log`), 발생기 CPU · 메모리(`-generator.txt`, 15초마다), 서버 자원 요약(`-resources.txt`)을 남기고, 단계별 시각을 `results/s5-levels.tsv`에 쌓는다. 면접이 하나라도 실패하면 그 단계에서 멈춘다(`CONTINUE=1`이면 계속)
- 재는 것: 질문 준비 · 첫 질문(면접관 입장) · 질문 간격 · 면접 · 결과 · 다시보기 시간. 첫 질문이 2분 안에 안 나오면 "면접관 입장" 실패로 센다(에이전트가 새 면접을 받지 않을 때)
- Chromium은 WebGL을 끈다(면접관 3D 화면은 정지 이미지로 대신 나온다). 켜면 Chromium 1개가 노트북 CPU를 약 9코어 쓴다. 끄면 약 1.5코어 · 430MB. `BROWSER_3D=1`이면 켠다
- 노트북 여러 대: 노트북마다 `ACCOUNT_OFFSET`(0 · 10 …)과 같은 `START_AT`(유닉스 초)을 주고 `s5-interview-browser.js`를 돌린다

## 값

| 이름 | 기본값 | 쓰는 곳 |
|---|---|---|
| `BASE_URL` | `https://lt.hangguet.co.kr` | 모든 스크립트 |
| `LOADTEST_PASSWORD` | (필수) | 모든 스크립트 |
| `COUNT` · `START` | 1 · 1 | `seed.js`: 만들 계정 수 · 시작 번호 |
| `N` | 1 | S0: 차례로 돌릴 면접 수 |
| `ACCOUNT_OFFSET` | 0 | 노트북마다 다른 계정 범위를 쓸 때(계획 6장 S5) |
| `PERSONA` · `MODE` | `COFFEE_CHAT` · `CHAT` | `s0-smoke.js` |
| `PER_ACCOUNT` | 3 | `interviews-browser.js`: 계정마다 만들 면접 수 |
| `RATES` · `HOLD` · `RAMP` | `5,30,60` · `10m` · `1m` | `s1-web-mix.js`: 단계별 초당 요청 수 · 유지 시간 · 올리는 시간 |
| `ACCOUNTS` | 4 | `s1-web-mix.js`: 돌려 쓸 계정 수(앞에서부터, 끝낸 면접이 있어야 한다) |
| `VUS` · `MAX_VUS` | 20 · 300 | `s1-web-mix.js`: 미리 만들 VU · 최대 VU |
| `N` · `STAGGER` · `START_AT` | 1 · 3 · (지금) | `s5-interview-browser.js`: 동시 면접 수 · 시작 간격(초) · 시작 시각(유닉스 초) |
| `LEVELS` · `COOLDOWN` · `CONTINUE` | `1 3 5 8 10` · 120 · 0 | `s5-levels.sh`: 단계 · 단계 사이 쉬는 시간(초) · 실패해도 계속 |
| `BROWSER_3D` | 0 | 브라우저 시나리오에서 WebGL(면접관 3D)을 켤지 |

## 주의

- 테스트 서버 이미지 태그(운영과 같음)의 API에 맞춰 짰다. develop의 API가 바뀌어도 운영 태그가 바뀌기 전에는 테스트 서버에 반영되지 않는다
- 서버 쪽 지표는 `https://grafana-lt.hangguet.co.kr`에서 같은 시간 구간을 본다(계획 5.2)
