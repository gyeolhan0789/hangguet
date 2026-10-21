# 회사 카드 파이프라인 Airflow (로컬)

`ai/pipeline`의 회사 카드 만들기를 Airflow 3.3으로 자동 실행한다. 노트북 로컬용이다.

## DAG

| DAG | 언제 | 하는 일 |
|---|---|---|
| `company_news_daily` | 매일 13:00 (KST) | 회사 목록 → [회사별] 기사 수집 → [회사별] 최근 이슈만 갱신 → 확인 화면 데이터 갱신 |
| `company_cards_full` | 화면에서 ▶ 버튼 | 회사 목록 → [회사별] 기사 수집 → [회사별] 카드 전체 생성 → 확인 화면 데이터 갱신 |

- 회사 목록은 실행할 때마다 `pipeline/companies.json`을 읽는다. 회사를 추가해도 DAG를 고치지 않는다
- 카드가 없는 회사는 `company_news_daily`에서도 카드 전체를 만든다
- 카드 전체 생성은 프롬프트를 바꿨을 때, 새 사업보고서가 나왔을 때 쓴다. 사업보고서는 DART 접수번호가 바뀌었을 때만 다시 받는다
- 실패하면 5분 뒤 2번까지 다시 시도한다. 한 회사가 실패해도 다른 회사는 계속 진행한다
- Ollama를 쓰는 작업(기사 묶기 임베딩, LLM 요약)은 `llm` 풀(크기 1)로 한 번에 하나씩 돈다. 11곳이 동시에 몰리면 Ollama 임베딩이 400, 네이버 검색 API가 429를 냈다
- 노트북이 꺼져 있던 날은 몰아서 돌리지 않는다(catchup 끔)

## 준비

- Docker Desktop 실행
- Ollama 실행 (`qwen3-8b-ctx`, `bge-m3`). 컨테이너에서 `host.docker.internal:11434`로 부른다
- `ai/.env`에 `DART_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `LLM_MODEL` ([pipeline/README.md](../pipeline/README.md))

## 켜기·끄기

```bash
cd ai/airflow
docker compose up -d     # 처음에는 이미지를 받느라 몇 분 걸린다
docker compose down      # 끄기. 실행 기록과 수집 데이터는 남는다
```

- 화면: http://localhost:8080 (로컬 전용이라 로그인 없이 관리자로 들어간다. 포트도 127.0.0.1에만 연다)
- 처음 켜면 DAG가 꺼진 채로 등록된다. 화면에서 DAG 스위치를 켜야 돈다
- 컨테이너: postgres(Airflow 실행 기록 전용, 회사 카드 DB 아님), api-server(화면), scheduler(LocalExecutor라 작업도 여기서 돈다), dag-processor. Celery·Redis는 쓰지 않는다

## 화면에서

- 흐름 보기: DAG 클릭 → 그래프 보기(`g`)
- 날짜·회사별 결과: 격자 보기(`w`). 회사별 칸 이름이 회사명으로 보인다
- 실패한 회사만 다시: 빨간 칸 → 로그 확인 → Clear
- 카드 내용 확인: `cd ai && uv run python -m pipeline.viewer`

## 회사 추가

`pipeline/companies.json`에 회사를 추가하면 다음 `company_news_daily` 실행(또는 ▶)에서 카드를 만든다.
`name`은 DART 등록 회사명과 정확히 같아야 한다. 틀리면 그 회사 작업만 실패한다.

## 데이터

지금은 `pipeline/data/`에 파일로 저장한다(git 제외). MinIO·S3 저장, 메인 DB 적재, Lightsail 배포는 다음 작업이다.
