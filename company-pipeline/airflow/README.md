# 회사 카드 파이프라인 Airflow + MinIO

`company-pipeline/pipeline`의 회사 카드 만들기를 Airflow 3.3으로 자동 실행하고, 받은 원문은 MinIO에 쌓는다. 로컬과 교보재 EC2에서 같은 compose 파일을 쓴다([EC2 배포](#ec2-배포)).

## DAG

| DAG | 언제 | 하는 일 |
|---|---|---|
| `company_news_daily` | 매일 13:00 (KST) | 회사 목록 → [회사별] 기사 수집 → [회사별] 최근 이슈만 갱신 → 확인 화면 데이터 갱신 |
| `company_cards_full` | 화면에서 ▶ 버튼 | 회사 목록 → [회사별] 기사 수집 → [회사별] 카드 전체 생성 → 확인 화면 데이터 갱신 |

- 회사 목록은 실행할 때마다 `pipeline/companies.json`을 읽는다. 회사를 추가해도 DAG를 고치지 않는다
- 카드가 없는 회사는 `company_news_daily`에서도 카드 전체를 만든다
- 카드 전체 생성은 프롬프트를 바꿨을 때, 새 사업보고서가 나왔을 때 쓴다. 사업보고서는 DART 접수번호가 바뀌었을 때만 다시 받는다
- 실패하면 5분 뒤 2번까지 다시 시도한다. 한 회사가 실패해도 다른 회사는 계속 진행한다
- LLM·임베딩을 부르는 작업은 `llm` 풀(크기 1)로 한 번에 하나씩 돈다. 11곳이 동시에 몰리면 임베딩 400, 네이버 검색 API 429가 났다
- 노트북이 꺼져 있던 날은 몰아서 돌리지 않는다(catchup 끔)
- 회사별 작업이 하나라도 실패하면 실행 전체가 실패로 표시된다(`all_companies_ok`). 확인 화면 갱신은 실패해도 돈다

## 준비

- Docker Desktop 실행
- `company-pipeline/.env`에 GMS 설정 (요약 gpt-4.1-mini, 임베딩 text-embedding-3-large). 로컬 Ollama로 돌리려면 [pipeline/README.md](../pipeline/README.md)의 로컬 설정
- `company-pipeline/.env`에 `DART_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `LLM_*`, `EMBED_*` ([pipeline/README.md](../pipeline/README.md))

## 켜기·끄기

```bash
cd company-pipeline/airflow
docker compose up -d     # 처음에는 이미지를 받느라 몇 분 걸린다
docker compose down      # 끄기. 실행 기록과 수집 데이터는 남는다
```

- Airflow 화면: http://localhost:8080 (로컬 전용이라 로그인 없이 관리자로 들어간다. 포트도 127.0.0.1에만 연다)
- MinIO 화면: http://localhost:9001 (로컬 전용 계정 `local-minio` / `local-minio-password`)
- 처음 켜면 DAG가 꺼진 채로 등록된다. 화면에서 DAG 스위치를 켜야 돈다
- 컨테이너: postgres(Airflow 실행 기록 전용, 회사 카드 DB 아님), api-server(화면), scheduler(LocalExecutor라 작업도 여기서 돈다), dag-processor, minio(원문 저장소), minio-init(처음 한 번 버킷 생성). Celery·Redis는 쓰지 않는다
- MinIO 이미지: 공식 `minio/minio` 이미지 배포가 끝나 MinIO 원본 코드로 만든 `cgr.dev/chainguard/minio`를 쓴다(무료는 latest 태그만 있다)

## 화면에서

- 흐름 보기: DAG 클릭 → 그래프 보기(`g`)
- 날짜·회사별 결과: 격자 보기(`w`). 회사별 칸 이름이 회사명으로 보인다
- 실패한 회사만 다시: 빨간 칸 → 로그 확인 → Clear
- 카드 내용 확인: `cd company-pipeline && uv run python -m pipeline.viewer` (MinIO 원문을 읽으려면 아래 `.env` 4줄 필요)

## EC2 배포

`company-pipeline/` 변경이 develop에 병합되면 CI `pipeline-deploy` 잡이 교보재 EC2에 배포한다(팀 개발 서버와 같은 방식).

```
develop 병합 → EC2 러너(태그 a301-pipeline-deploy, Protected, shell)
→ 코드를 /opt/a301-pipeline 으로 복사 (.env·pipeline/data·airflow/logs는 그대로)
→ docker compose up -d → scheduler 헬스체크
```

| 항목 | 내용 |
|---|---|
| 서버 | 교보재 EC2 t3.medium(2코어·4GB) + 스왑 2GB, 서울, `13.209.132.209`. 보안 그룹은 SSH(22)만 |
| 배포 폴더 | `/opt/a301-pipeline` (러너 계정 `gitlab-runner` 소유) |
| API 키 | `/opt/a301-pipeline/.env`에 처음 한 번 직접 둔다(소유자 `gitlab-runner`, 권한 600). git·CI 변수에 두지 않는다 |
| 메모리 | `AIRFLOW__CORE__PARALLELISM=4`. 기본 32면 실행 프로세스가 약 1GB를 잡아 4GB에서 작업이 메모리 부족으로 죽었다 |
| 폴더 권한 | 컨테이너 안 Airflow는 uid 50000. 배포 잡이 `pipeline/data`·`airflow/logs` 소유자를 맞춘다 |
| 카드 확인 화면 | `viewer` 컨테이너(127.0.0.1:8765, 읽기 전용: 회사 추가·검색 API 막음). 매일 작업이 갱신한 `data/viewer_data.js`를 보여 준다 |
| 공개 주소 | Cloudflare Tunnel `a301-pipeline-ec2` + Access(허용 이메일만, 일회용 코드). `pipeline.hangguet.co.kr` → Airflow(`localhost:8080`), 카드 확인 화면은 `localhost:8765`로 연결 |

- 처음 배포한 뒤 DAG는 꺼져 있다. 화면에서 `company_news_daily`를 켜야 13:00에 돈다
- 화면은 SSH 터널로 본다. Airflow가 로그인 없이 관리자로 들어가는 설정이라 8080·9001을 바깥에 열지 않는다
  ```bash
  ssh -i <pem> -L 8080:127.0.0.1:8080 ubuntu@13.209.132.209   # 브라우저 http://localhost:8080
  ```
- 롤백: GitLab Deployments → Environments → `pipeline` → 이전 배포 **Re-deploy**
- 급히 멈출 때: 서버에서 `cd /opt/a301-pipeline/airflow && sudo docker compose down` (수집 데이터 볼륨은 남는다. `-v`는 붙이지 않는다)
- 서버 처음 셋팅·러너 등록 방법: [박다빈/deploy_plan](../../박다빈/deploy_plan/README.md)

## 회사 추가

`pipeline/companies.json`에 회사를 추가하면 다음 `company_news_daily` 실행(또는 ▶)에서 카드를 만든다.
`name`은 DART 등록 회사명과 정확히 같아야 한다. 틀리면 그 회사 작업만 실패한다.

## 데이터 (MinIO 버킷 `company-pipeline`)

| 경로 | 들어가는 것 | 쓰는 방식 |
|---|---|---|
| `reference/corpcode.xml` | DART 회사 고유번호 목록. 아래 경로의 {고유번호} 기준 | 30일마다 덮어씀 |
| `raw/dart/reports/{고유번호}/{접수번호}.xml` | 사업보고서 원문 | 보고서마다 쌓음. 접수번호 파일이 없을 때만 받음 |
| `raw/talent/{고유번호}/{수집일}.txt` | 인재상 원문 (`companies.json`에서 복사) | 수집일마다 쌓음 |
| `raw/news/{고유번호}/{날짜}.json` | 네이버 뉴스 API 응답 그대로 (거르기 전) | 날마다 쌓음 |
| `processed/news/{고유번호}.json` | 최근 30일 기사, 같은 사건 묶음 번호 | 매일 덮어씀 (raw에서 다시 만들 수 있음) |

- `raw/`는 덮어쓰지 않는다. 규칙·프롬프트를 바꿔도 다시 받지 않고 다시 가공할 수 있다
- 카드는 아직 `pipeline/data/cards/`(git 제외)에 둔다. 카드 형식은 [pipeline/README.md](../pipeline/README.md#카드-형식). S3 업로드·메인 DB 적재는 다음 작업이다
- 서버 배포는 MVP 서버(Lightsail)가 아니라 교보재 EC2에 한다. 계획: [박다빈/deploy_plan](../../박다빈/deploy_plan/README.md)
- Docker 없이 직접 실행할 때 `S3_ENDPOINT`가 없으면 MinIO 대신 `pipeline/data/` 폴더에 같은 경로로 저장한다. 직접 실행하면서 MinIO를 쓰려면 `company-pipeline/.env`에 추가한다(컨테이너는 compose 설정이 우선이라 영향 없음):

```
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=local-minio
S3_SECRET_KEY=local-minio-password
S3_BUCKET=company-pipeline
```

MinIO 경로의 {고유번호}가 어느 회사인지는 카드 파일(`pipeline/data/cards/{고유번호}.json`의 `name`)이나 `reference/corpcode.xml`에서 찾는다.
