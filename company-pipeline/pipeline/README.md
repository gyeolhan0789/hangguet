# 회사 카드 파이프라인

회사의 사업보고서·인재상·최근 기사를 모아, 출처가 달린 회사 카드(JSON)를 만든다. MVP 범위 밖(고도화) 기능이다.
카드 항목: 인재상(`talent`), 사업 방향(`direction`), 경쟁·시장(`market`), 최근 이슈(`recent`).

```
companies.json → ① 공시 수집 → ② 사업의 내용 추출 ┐
⑤ 뉴스 수집(규칙으로 거르기 → 같은 사건 묶기) ───────┴→ ③ LLM 요약(원문 인용) → ④ 인용 검증
                                                      → data/cards/{고유번호}.json
                                                      → ⑥ 카드 올리기(AWS 공용 버킷, BE가 적재)
```

③은 항목마다 LLM을 따로 부른다(인재상, 사업 방향, 경쟁·시장, 최근 이슈 → 회사당 최대 4번). 원문이 없는 항목은 부르지 않는다.
인재상은 요약하지 않고 원문 구조(항목명·상위 범주·설명 구절)를 그대로 옮기는 추출이라 프롬프트를 `talent_prompt.txt`에 두고, `TALENT_LLM_MODEL`로 다른 모델을 쓸 수 있다.

## 카드 형식

`data/cards/{DART 고유번호}.json` 하나가 회사 하나다. 예시(삼성SDI, 항목마다 첫 번째만. 인재상은 card-v9 형식):

```json
{
  "corp_code": "00126362",
  "name": "삼성SDI",
  "generated_at": "2026-10-23",
  "prompt_version": "card-v9",
  "model": "gpt-4.1-mini",
  "talent_model": "gpt-5.6-terra",
  "report": {"rcept_no": "20260317000521", "title": "사업보고서 (2025.12)",
             "url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260317000521",
             "published": "2026-03-17"},
  "talent_page": {"url": "https://www.samsungsdi.co.kr/career/index.html",
                  "collected_at": "2026-10-20"},
  "talent": [
    {"title": "Passion and Challenge", "parent": null,
     "details": ["열정과 도전", "끊임없는 열정으로 미래에 도전하는 인재"],
     "source": "https://www.samsungsdi.co.kr/career/index.html"}
  ],
  "direction": [
    {"summary": "전지 사업 중심 시설투자 계획",
     "quote": "2026년은 전지 사업을 중심으로 전 사업부문에 시설투자를 계획 중이며, ...",
     "source": "최신 사업보고서 II. 사업의 내용"}
  ],
  "market": [
    {"summary": "주요 매출처 BMW, VWG, 삼성전자 등",
     "quote": "당사의 주요 매출처로는 Bayerische Motoren Werke (\"BMW\"), ...",
     "source": "최신 사업보고서 II. 사업의 내용"}
  ],
  "recent": [
    {"summary": "삼성SDI 국제화학올림피아드 한국 대표단 후원 협약",
     "quote": "삼성SDI, 국제화학올림피아드 한국 대표단 후원 협약",
     "source": "https://www.yna.co.kr/view/AKR20261022024400003?input=1195m",
     "published": "2026-10-22", "articles": 72}
  ]
}
```

| 필드 | 뜻 |
|---|---|
| `corp_code`, `name` | DART 고유번호, DART 등록 회사명 |
| `generated_at`, `prompt_version`, `model`, `talent_model` | 카드를 만든 날, 프롬프트 버전, LLM 모델, 인재상에 쓴 모델 (최근 이슈만 갱신해도 `generated_at`이 바뀐다) |
| `report` | `direction`·`market`을 뽑은 사업보고서. `rcept_no` DART 접수번호, `title` 보고서명, `url` DART 공시 화면, `published` 접수일. 사업보고서가 없으면 `null` |
| `talent_page` | `talent`를 뽑은 인재상 원문. `url` 채용 페이지 주소, `collected_at` 복사한 날. 인재상 원문이 없으면 `null` |
| `talent[]` | 원문에 나열된 인재상·행동 원칙마다 하나(개수 제한 없음). `title` 항목명 또는 원칙 문장, `parent` 상위 범주(없으면 `null`), `details` 설명 구절 배열(없으면 `[]`)로 셋 다 원문 그대로. `source` 채용 페이지 주소. 상위 범주 아래 세부 항목이 있으면 세부 항목이 하나씩 들어간다 |
| `direction[]` | 앞으로 집중·강화하려는 사업 방향 1~3개. `summary` 요약, `quote` 사업보고서 원문 그대로, `source` 출처 이름 |
| `market[]` | 경쟁 위치(점유율·주요 고객·경쟁사 등) 1~3개. 필드는 `direction`과 같다 |
| `recent[]` | 최근 30일 이슈 1~3개. `summary` 요약, `quote` 기사 제목·요약 원문, `source` 기사 링크, `published` 기사 날짜, `articles` 같은 사건 기사 수 |

- 모든 `quote`는 원문에 글자 그대로 있는지 검사를 통과한 것만 남는다(④). 인재상은 `title`·`parent`·`details`가 모두 원문에 그대로 있어야 한다. 그래서 항목이 0개일 수 있다
- card-v8 이전 카드의 인재상은 `keyword`·`quote` 형식이다. 확인 화면은 두 형식을 모두 보여 준다
- 사업보고서가 없는 회사(비상장 등)는 `direction`·`market`이 빈 배열인 **부분 카드**다
- 인재상 원문이 없는 회사는 `talent`가 빈 배열이다
- `report`·`talent_page`는 카드 전체 생성 때 채운다(2026-10-30 추가). 그 전에 만든 카드에는 칸이 없고, 매일 작업(최근 이슈만 갱신)은 기존 칸을 그대로 둔다. 그래서 칸이 없는 카드를 다시 채우려면 카드 전체 생성을 한 번 돌린다
- 카드 형식은 BE를 거쳐 AI 작업 메시지(`companyCard`)로 그대로 넘어간다. 칸을 바꾸거나 빼면 `prompt_version`을 올리고 AI 담당과 맞춘다([회사 카드 ERD](../../docs/ERD-회사카드.md))

## 현황 (2026-10-26)

| 항목 | 수 |
|---|---|
| 회사(`companies.json`) | 111 |
| 인재상 원문 있음 | 63 (나머지는 공식 페이지가 없거나 JS·이미지라 못 읽음) |
| 기사 검색어(`news_query`) 따로 지정 | 15 (예: 비바리퍼블리카 → 토스) |
| 카드 | 111 |
| `talent` 빈 카드 | 50 |
| `direction`·`market` 모두 빈 카드 | 9 (사업보고서 없는 부분 카드 8 + 메리츠금융지주 1: 보고서는 있으나 검증을 통과한 항목이 없음, 원인 미확인) |
| `recent` 빈 카드 | 3 (증권사 등 주가·시황 기사가 거의 전부라 규칙에서 걸러짐) |

100곳은 SSAFY 지원자가 많은 업종에서 골랐다(채용 사이트를 보고 고르지 않음). 인재상은 회사·그룹 공식 채용 페이지에서 가져와 페이지 원본에 글자 그대로 있는 줄만 남겼다.

## 회사 목록

`companies.json`에 회사를 적는다. `name`은 DART에 등록된 회사명과 정확히 같아야 한다.
인재상은 공식 채용 페이지에서 글자 그대로 복사해 `talent_text`에, 그 페이지 주소를 `talent_url`에,
복사한 날짜를 `talent_collected_at`에 넣는다. 인재상 페이지가 없으면 "일하는 방식" 같은 페이지를 쓰고,
그것도 없으면 비워 둔다(카드에 사업 방향만 남는다).

`aliases`(선택)는 지원자가 지원서에 쓸 수 있는 다른 이름을 쉼표로 적는다(예: `"SDS, 삼성 SDS"`).
회사명·DART 영문명·기사 검색어는 따로 적지 않아도 별칭에 들어간다. BE는 지원서 회사명을 별칭에서 찾아 카드를 붙인다(⑥).

### 회사 후보 추가 도구

DART 정식 회사명을 몰라도 된다. 채용 사이트 등을 보고 **회사 이름만** 한 줄에 하나씩 파일에 적고 돌린다.
채용 사이트를 자동으로 긁지 않는다(자소설닷컴은 약관에서 자동 수집을 금지한다).

```bash
cd company-pipeline
uv run --env-file .env python -m pipeline.candidates 후보.txt
```

```
✓ LG CNS → LG씨엔에스 (00139834, 상장): 추가 가능
✓ 토스 → 비바리퍼블리카 (01212921, 비상장) [AI로 정식명 찾음, 확인 필요]: 추가 가능
- 삼성SDS → 삼성에스디에스 (00126186, 상장) [AI로 정식명 찾음, 확인 필요]: 이미 카드 있음
△ 코스콤 → 코스콤 (00159661, 비상장): 사업보고서 없음 → 인재상·최근 이슈만 있는 부분 카드
? 엔씨소프트: 정확히 맞는 회사 없음
```

- 정식 회사명 → 띄어쓰기·(주)·Co., Ltd를 지운 회사명·영문명 순으로 찾는다. 같은 이름이면 상장사,
  상장사도 여럿이면(합병된 옛 SK·삼성물산 등이 종목코드를 단 채 남아 있음) 최근 수정된 회사
- 그래도 없으면 AI(`LLM_*`)에게 정식 회사명을 묻고, DART 목록에서 하나로 정해질 때만 쓴다(`[AI로 정식명 찾음]`)
- 못 찾으면 비슷한 이름을 보여 준다. 이름이 바뀐 회사는 새 이름으로 적는다(엔씨소프트 → `NC`)
- 끝에 `companies.json`에 붙여 넣을 줄을 출력한다. 입력한 이름이 정식명과 다르면 기사 검색어(`news_query`)로 넣는다. 인재상 칸은 사람이 채운다

```json
[{"name": "삼성전자", "news_query": "기사 검색어(회사명과 다를 때만)", "aliases": "별칭(선택, 쉼표로 구분)", "talent_url": "채용 페이지 주소", "talent_text": "인재상 원문", "talent_collected_at": "2026-10-20"}]
```

## 환경변수

`company-pipeline/.env`에 넣는다. `.env`는 git에서 제외되어 있다.

| 이름 | 내용 |
|---|---|
| `DART_API_KEY` | opendart.fss.or.kr 인증키 |
| `LLM_CHAT_URL` | OpenAI 호환 chat completions 주소 |
| `LLM_MODEL` | 모델 이름 |
| `LLM_API_KEY` | API 키 (로컬 모델은 비움) |
| `LLM_REASONING_EFFORT` | 생각 모드가 있는 로컬 모델에서 끌 때 `none` (gpt-4 계열은 비움) |
| `TALENT_LLM_MODEL` | 인재상 추출에만 쓰는 모델 (비우면 `LLM_MODEL`). gpt-4.1-mini는 계층형 인재상(분류 > 세부 항목)의 구분을 지키지 못해 더 강한 모델을 쓴다 |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | developers.naver.com 애플리케이션의 검색 API 키 |
| `EMBED_URL`, `EMBED_MODEL`, `EMBED_API_KEY` | 기사 묶기용 embeddings 주소·모델·키 (비우면 로컬 Ollama `bge-m3`) |
| `SAME_EVENT` | 같은 사건 묶기 기준값. 기본 0.58(text-embedding-3-large), bge-m3면 0.65 |
| `CARD_S3_BUCKET` | 카드를 올릴 AWS 공용 버킷(⑥). 비우면 `data/publish/`에 쓴다 |
| `CARD_AWS_ACCESS_KEY_ID`, `CARD_AWS_SECRET_ACCESS_KEY` | 공용 버킷 쓰기 키(IAM `a301-company-pipeline`). MinIO용 `S3_*`와 따로 둔다 |
| `CARD_AWS_REGION` | 공용 버킷 리전 (기본 `ap-northeast-2`) |

기본 설정 (SSAFY GMS, 2026-10-22 모델 비교로 선택):

```
LLM_CHAT_URL=https://gms.ssafy.io/gmsapi/api.openai.com/v1/chat/completions
LLM_MODEL=gpt-4.1-mini
TALENT_LLM_MODEL=gpt-5.6-terra
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
cd company-pipeline
uv run --env-file .env python -m pipeline.news             # 최근 기사 수집 (날마다, 먼저)
uv run --env-file .env python -m pipeline.run              # companies.json 전체
uv run --env-file .env python -m pipeline.run --only 카카오  # 한 곳만
uv run --env-file .env python -m pipeline.publish          # 카드를 공용 버킷에 올리기
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
cd company-pipeline
uv run --env-file .env python -m pipeline.viewer
```

카드와 근거 원문을 묶어 로컬 서버(http://127.0.0.1:8765/viewer.html)를 띄우고 브라우저로 연다.
인용 위치가 원문에 강조된다. 끄려면 Ctrl+C. `pipeline.run`도 끝날 때 화면 데이터를 갱신한다.

오른쪽 위 **+ 회사 추가**로 회사를 `companies.json`에 넣는다.

- DART 고유번호 목록에서 한글명·영문명으로 검색해 **고른 회사만** 추가한다(직접 친 이름은 추가하지 않는다)
- 검색에 없는 약칭은 "AI로 정식 회사명 찾기"(DART 목록에서 하나로 정해질 때만 보여 줌)
- 고르면 최근 1년 사업보고서가 있는지 DART로 확인한다. 없으면(비상장 등) 인재상·최근 이슈만 있는 부분 카드가 된다. 이미 등록된 회사는 추가할 수 없다
- 기사 검색어·별칭·인재상(페이지 주소, 원문)은 함께 넣거나 비워 두고 나중에 채운다
- 추가 후 다음 매일 작업(13:00)이나 Airflow ▶에서 카드가 만들어진다. `companies.json` 변경은 커밋해야 팀에 반영된다
- 서버는 127.0.0.1에만 열려 이 컴퓨터에서만 쓸 수 있다
- EC2에서는 compose의 `viewer` 컨테이너가 띄우고, `https://pipeline-cards.hangguet.co.kr/viewer.html`(Cloudflare Access, 허용 이메일만)에서 **바로 회사를 추가**할 수 있다
- 서버의 회사 목록은 git의 `pipeline/companies.json`이 아니라 `COMPANIES_PATH`(`pipeline/data/companies.json`, 배포 때 덮어쓰지 않음)다. 처음에는 git 목록을 복사해 시작하고, 그 뒤로는 **서버 목록이 기준**이다. git 목록을 고쳐도 서버에는 반영되지 않으니, 서버에 넣거나 고치려면 화면에서 한다
- `VIEWER_READONLY=1`로 띄우면 회사 추가·정보 수정·검색 API를 막고 화면만 보여 준다

카드 위(카드가 없는 회사는 대기 화면)의 **정보 수정**으로 이미 있는 회사의 칸을 고친다.

- 고칠 수 있는 칸: 기사 검색어, 인재상 페이지 주소, 인재상 원문, 인재상 복사한 날짜. 회사명(DART 정식명)은 고칠 수 없다
- 인재상 원문을 고치면 복사한 날짜가 오늘로 바뀐다(직접 바꿀 수 있다)
- 매일 작업(13:00)은 최근 이슈만 갱신해서, 고친 인재상은 다음 Airflow ▶(`company_cards_full`)에서 카드에 반영된다. 기사 검색어는 다음 매일 작업부터 쓰인다
- 저장은 임시 파일에 쓴 뒤 바꿔 끼워서, 저장 중에 Airflow가 읽어도 깨진 파일을 보지 않는다

오른쪽 위 **목록 전체 바꾸기**로 `companies.json`을 통째로 바꾼다. 회사 삭제나 여러 회사를 한꺼번에 고칠 때 쓴다.

1. **지금 목록 내려받기**로 받은 파일을 고친다
2. 고친 파일을 고르거나 붙여 넣고 **확인**: 추가·삭제·변경되는 회사를 보여 준다(저장하지 않음)
3. **바꾸기**: 확인한 내용 그대로일 때만 바뀐다. 이전 목록은 같은 폴더에 `companies-{날짜시각}.json.bak`으로 남는다

- 아래 문제가 하나라도 있으면 바꾸지 않고 문제 목록을 보여 준다: JSON 배열이 아님, 회사명(`name`) 없음, 같은 회사 두 번, 모르는 칸(오타), 문자열이 아닌 값, DART 목록에 없는 회사명
- 칸 정리는 회사 추가와 같다(앞뒤 공백 제거, 회사명과 같은 기사 검색어는 뺌, 인재상 원문이 없으면 수집일 비움)
- 목록에서 뺀 회사의 카드(`data/cards/`)는 지우지 않아 확인 화면에 남는다. 매일 작업·▶에서는 더 이상 갱신되지 않는다
- 되돌릴 때는 백업 파일을 내려받아 다시 **목록 전체 바꾸기**로 넣는다(서버에서는 SSH로 백업 파일을 확인)

## 데이터

원문·기사는 `storage.py`로 저장한다. `S3_ENDPOINT`가 있으면 MinIO, 없으면 `data/` 폴더에 같은 경로(`reference/`·`raw/`·`processed/`)로 둔다. 경로 구조는 [Airflow README](../airflow/README.md#데이터-minio-버킷-company-pipeline). 만든 카드는 `data/cards/`에 저장한다. `data/`는 git에서 제외한다.

## 카드 올리기 (⑥)

`publish.py`가 카드와 `manifest.json`을 AWS 공용 버킷(`CARD_S3_BUCKET`)에 올린다. Airflow는 두 DAG 끝에서 자동으로 부른다.
원문·기사는 MinIO에 그대로 두고, BE가 읽을 카드만 올린다. 개발·운영 BE가 같은 버킷을 읽어 각자 DB에 넣는다(설계: [회사 카드 ERD](../../docs/ERD-회사카드.md)).

| 키 | 내용 |
|---|---|
| `cards/{고유번호}/{sha256}.json` | 카드 파일 그대로. 내용이 바뀌면 키도 바뀐다 |
| `manifest.json` | 이번에 올린 회사 목록. 카드를 모두 올린 뒤 마지막에 쓴다 |

```json
{
  "format": 1,
  "run_id": "2026-10-30T13:42:10+09:00",
  "companies": [
    {"corp_code": "00126186", "name": "삼성에스디에스", "is_listed": true,
     "aliases": ["삼성에스디에스", "samsungsds", "삼성sds", "sds"],
     "generated_at": "2026-10-30", "card_key": "cards/00126186/9f2c….json", "sha256": "9f2c…"}
  ]
}
```

- `aliases`는 회사명·DART 영문명·기사 검색어·`aliases` 칸을 `candidates.key` 규칙(띄어쓰기·문장부호·`(주)`·`주식회사`·Co., Ltd·Corp·Inc 제거, 소문자)으로 맞춘 것이다. BE도 지원서 회사명을 같은 규칙으로 맞춰 찾는다
- `sha256`은 올린 카드 파일 내용의 해시다. BE는 지금 카드와 해시가 같으면 건너뛴다
- 회사 목록에 있고 카드가 있는 회사만 올린다. 목록에서 뺀 회사는 manifest에서 빠진다(BE는 이미 넣은 카드를 지우지 않는다)
- 바뀌지 않은 카드도 매번 같은 키로 다시 올린다. 버킷 수명 주기로 지난 카드(`cards/`, 30일)를 정리해도 지금 카드는 남는다
- 올릴 카드가 하나도 없으면 실패한다(빈 manifest를 쓰지 않는다)
