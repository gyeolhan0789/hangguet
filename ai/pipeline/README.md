# 회사 카드 파이프라인 (MVP)

회사의 사업보고서와 인재상을 모아, 출처가 달린 회사 카드(JSON)를 만든다.

```
companies.json → ① 공시 수집 → ② 사업의 내용 추출 → ③ LLM 요약(원문 인용) → ④ 인용 검증
              → data/cards/{고유번호}.json
```

## 회사 목록

`companies.json`에 회사를 적는다. `name`은 DART에 등록된 회사명과 정확히 같아야 한다.
인재상은 공식 채용 페이지에서 글자 그대로 복사해 `talent_text`에, 그 페이지 주소를 `talent_url`에,
복사한 날짜를 `talent_collected_at`에 넣는다. 인재상 페이지가 없으면 "일하는 방식" 같은 페이지를 쓰고,
그것도 없으면 비워 둔다(카드에 사업 방향만 남는다).

```json
[{"name": "삼성전자", "talent_url": "채용 페이지 주소", "talent_text": "인재상 원문", "talent_collected_at": "2026-10-20"}]
```

## 환경변수

`ai/.env`에 넣는다. `.env`는 git에서 제외되어 있다.

| 이름 | 내용 |
|---|---|
| `DART_API_KEY` | opendart.fss.or.kr 인증키 |
| `LLM_CHAT_URL` | OpenAI 호환 chat completions 주소 |
| `LLM_MODEL` | 모델 이름 |
| `LLM_API_KEY` | API 키 (로컬 모델은 비움) |
| `LLM_REASONING_EFFORT` | 생각 모드가 있는 모델에서 끌 때 `none` (GMS는 비움) |

로컬 개발 (Ollama, qwen3:8b · 입력 길이 10240 토큰 설정 모델):

```
LLM_CHAT_URL=http://localhost:11434/v1/chat/completions
LLM_MODEL=qwen3-8b-ctx
LLM_REASONING_EFFORT=none
```

GMS가 발급되면 `LLM_CHAT_URL`, `LLM_MODEL`, `LLM_API_KEY`만 바꾼다.

## 실행

```bash
cd ai
uv run --env-file .env python -m pipeline.run              # companies.json 전체
uv run --env-file .env python -m pipeline.run --only 카카오  # 한 곳만
```

- 한 회사가 실패해도 나머지는 계속하고, 끝에 실패한 회사를 알려 준다
- 원문에 없는 인용으로 버린 항목은 WARNING 로그로 남는다
- 이미 받은 사업보고서는 다시 받지 않는다

## 확인 화면

```bash
cd ai
uv run python -m pipeline.viewer
```

카드와 근거 원문을 묶어 로컬 서버(http://127.0.0.1:8765/viewer.html)를 띄우고 브라우저로 연다.
인용 위치가 원문에 강조된다. 끄려면 Ctrl+C. `pipeline.run`도 끝날 때 화면 데이터를 갱신한다.

## 데이터

수집한 원문은 `data/raw/`, 만든 카드는 `data/cards/`에 저장하며 둘 다 git에서 제외한다.
