# 회사 카드 파이프라인 (MVP)

회사의 사업보고서·인재상·최근 기사를 모아, 출처가 달린 회사 카드(JSON)를 만든다.
카드 항목: 인재상(`talent`), 사업 방향(`direction`), 경쟁·시장(`market`), 최근 이슈(`recent`).

```
companies.json → ① 공시 수집 → ② 사업의 내용 추출 ┐
⑤ 뉴스 수집(규칙으로 거르기 → 같은 사건 묶기) ───────┴→ ③ LLM 요약(원문 인용) → ④ 인용 검증
                                                      → data/cards/{고유번호}.json
```

## 회사 목록

`companies.json`에 회사를 적는다. `name`은 DART에 등록된 회사명과 정확히 같아야 한다.
인재상은 공식 채용 페이지에서 글자 그대로 복사해 `talent_text`에, 그 페이지 주소를 `talent_url`에,
복사한 날짜를 `talent_collected_at`에 넣는다. 인재상 페이지가 없으면 "일하는 방식" 같은 페이지를 쓰고,
그것도 없으면 비워 둔다(카드에 사업 방향만 남는다).

```json
[{"name": "삼성전자", "news_query": "기사 검색어(회사명과 다를 때만)", "talent_url": "채용 페이지 주소", "talent_text": "인재상 원문", "talent_collected_at": "2026-10-20"}]
```

## 환경변수

`ai/.env`에 넣는다. `.env`는 git에서 제외되어 있다.

| 이름 | 내용 |
|---|---|
| `DART_API_KEY` | opendart.fss.or.kr 인증키 |
| `LLM_CHAT_URL` | OpenAI 호환 chat completions 주소 |
| `LLM_MODEL` | 모델 이름 |
| `LLM_API_KEY` | API 키 (로컬 모델은 비움) |
| `LLM_REASONING_EFFORT` | 생각 모드가 있는 로컬 모델에서 끌 때 `none` (gpt-4 계열은 비움) |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | developers.naver.com 애플리케이션의 검색 API 키 |
| `EMBED_URL`, `EMBED_MODEL`, `EMBED_API_KEY` | 기사 묶기용 embeddings 주소·모델·키 (비우면 로컬 Ollama `bge-m3`) |
| `SAME_EVENT` | 같은 사건 묶기 기준값. 기본 0.58(text-embedding-3-large), bge-m3면 0.65 |

기본 설정 (SSAFY GMS, 2026-10-22 모델 비교로 선택):

```
LLM_CHAT_URL=https://gms.ssafy.io/gmsapi/api.openai.com/v1/chat/completions
LLM_MODEL=gpt-4.1-mini
LLM_API_KEY=GMS 키
EMBED_URL=https://gms.ssafy.io/gmsapi/api.openai.com/v1/embeddings
EMBED_MODEL=text-embedding-3-large
EMBED_API_KEY=GMS 키
```

로컬 개발 (Ollama, GPU 필요): `LLM_CHAT_URL=http://localhost:11434/v1/chat/completions`,
`LLM_MODEL=qwen3-8b-ctx`(입력 길이 10240 토큰 설정), `LLM_REASONING_EFFORT=none`, `SAME_EVENT=0.65`,
`LLM_API_KEY`·`EMBED_*`는 지운다 (`ollama pull bge-m3`).

| 모델 비교 (11곳) | 인용 검증 통과 | 시간 |
|---|---|---|
| qwen3 8B (로컬) | 110/125 (경쟁·시장 21/26) | 6분 27초 |
| gpt-4.1-mini (선택) | 124/129 (인재상·사업방향·경쟁·시장 100%) | 1분 23초 |
| gpt-4o-mini | 123/126 | 2분 15초 |
| gpt-5-mini | 134/137 (회사 소개 문장을 고르고 최근 이슈를 지시보다 많이 냄) | 2분 44초 |
| gpt-5-nano | 134/149 (사업방향·경쟁·시장을 적게 찾음) | 1분 31초 |

## 실행

자동 실행(매일 13:00 뉴스·최근 이슈, 버튼으로 카드 전체 생성)은 [Airflow](../airflow/README.md)로 한다. 직접 실행할 때:

```bash
cd ai
uv run --env-file .env python -m pipeline.news             # 최근 기사 수집 (날마다, 먼저)
uv run --env-file .env python -m pipeline.run              # companies.json 전체
uv run --env-file .env python -m pipeline.run --only 카카오  # 한 곳만
```

- 한 회사가 실패해도 나머지는 계속하고, 끝에 실패한 회사를 알려 준다
- 원문에 없는 인용으로 버린 항목은 WARNING 로그로 남는다
- 사업보고서는 DART 접수번호가 바뀌었을 때(새 보고서·정정 보고서)만 다시 받는다
- 기사를 아직 안 모은 회사는 최근 이슈 없이 만든다

## 뉴스 수집 규칙

- 네이버 뉴스 검색 API로 관련도순 100건. 기사 본문은 받지 않고 제목·요약·링크·날짜만 저장
- 버리는 기사: 30일 지난 기사, 제목에 회사 이름이 없는 기사, 주가·시황·증권사·광고·이벤트 기사(`news.py`의 `_NOISE`)
- 한 번에 2~3일치만 잡혀서 날마다 모아 쌓는다(같은 제목은 하나, 30일 지난 기사는 빠짐)
- 같은 사건 묶기: 제목 임베딩 유사도가 묶음 첫 기사와 `SAME_EVENT` 이상이면 같은 묶음.
  LLM에는 큰 묶음부터 12개까지, 묶음마다 최신 기사 1건과 기사 수만 넣는다

## 확인 화면

```bash
cd ai
uv run python -m pipeline.viewer
```

카드와 근거 원문을 묶어 로컬 서버(http://127.0.0.1:8765/viewer.html)를 띄우고 브라우저로 연다.
인용 위치가 원문에 강조된다. 끄려면 Ctrl+C. `pipeline.run`도 끝날 때 화면 데이터를 갱신한다.

## 데이터

원문·기사는 `storage.py`로 저장한다. `S3_ENDPOINT`가 있으면 MinIO, 없으면 `data/` 폴더에 같은 경로(`reference/`·`raw/`·`processed/`)로 둔다. 경로 구조는 [Airflow README](../airflow/README.md#데이터-minio-버킷-company-pipeline). 만든 카드는 `data/cards/`에 저장한다. `data/`는 git에서 제외한다.
