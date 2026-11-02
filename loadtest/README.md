# 부하 테스트 (k6)

기준 문서는 [부하 테스트 계획](../이해준/load_test_plan/README.md)이다. 부하는 운영 서버가 아니라 **테스트 서버**(`https://lt.hangguet.co.kr`, [server/](server/README.md))에 보낸다.

## 폴더

| 경로 | 내용 |
|---|---|
| `run.sh` | k6 실행. k6가 없으면 Docker 이미지(`grafana/k6:2.3.0`)로 돌린다. `.env.k6` 값을 `-e`로 넘긴다 |
| `lib/` | 공통 모듈: 설정(`config.js`), BE API · FE 페이지 호출(`api.js`), 가입 · 로그인(`auth.js`), 지원서 · 면접(`interview.js`), 계정 목록(`accounts.js`), 지어낸 지원서 · 답변(`data.js`) |
| `seed/seed.js` | 테스트 계정 · 지원서 만들기 → `seed/accounts.json`(커밋하지 않는다) |
| `scenarios/` | 시나리오(계획 6장). 지금은 S0(`s0-smoke.js` · `s0-browser.js`) |
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

## 값

| 이름 | 기본값 | 쓰는 곳 |
|---|---|---|
| `BASE_URL` | `https://lt.hangguet.co.kr` | 모든 스크립트 |
| `LOADTEST_PASSWORD` | (필수) | 모든 스크립트 |
| `COUNT` · `START` | 1 · 1 | `seed.js`: 만들 계정 수 · 시작 번호 |
| `N` | 1 | S0: 차례로 돌릴 면접 수 |
| `ACCOUNT_OFFSET` | 0 | 노트북마다 다른 계정 범위를 쓸 때(계획 6장 S5) |
| `PERSONA` · `MODE` | `COFFEE_CHAT` · `CHAT` | `s0-smoke.js` |

## 주의

- 테스트 서버 이미지 태그(운영과 같음)의 API에 맞춰 짰다. develop의 API가 바뀌어도 운영 태그가 바뀌기 전에는 테스트 서버에 반영되지 않는다
- 서버 쪽 지표는 `https://grafana-lt.hangguet.co.kr`에서 같은 시간 구간을 본다(계획 5.2)
