# A301

AI 기반 실전 모의면접 서비스

## 프로젝트 문서

- [전체 기획](docs/전체기획.md)
- [Git 협업 가이드](docs/CONTRIBUTING.md)
- [API 명세](docs/API-명세.md)
- [연습 기록 화면 API](docs/연습기록-API.md)
- [AI 명세](docs/AI-명세.md)
- [면접관 표현 모듈 · TTS](박연수/interviewer-avatar/README.md)
- [AI 면접관 아바타 기술 조사](한결/avatar-research.md)

## 프로젝트 구조

| 폴더 | 파트 | 스택 |
| --- | --- | --- |
| [`backend/`](backend) | BE | Java 21, Spring Boot 4.1, PostgreSQL 18, Flyway |
| [`frontend/`](frontend) | FE | Node 24, Next.js 16, TypeScript, Vitest |
| [`ai/`](ai) | AI | Python 3.13, FastAPI, uv |
| [`company-pipeline/`](company-pipeline) | AI (회사 카드 파이프라인, MVP 밖) | Python 3.13, uv, Airflow 3, MinIO |

## 로컬 실행

필요한 도구: JDK 21, Node 24, [uv](https://docs.astral.sh/uv/), Docker

```bash
# 1. DB (PostgreSQL 18, localhost:5433)
docker compose up -d

# 2. BE → http://localhost:8080/actuator/health
cd backend && ./gradlew bootRun

# 3. FE → http://localhost:3000/api/health
cd frontend && npm ci && npm run dev

# 4. AI → http://localhost:8000/health
cd ai && uv sync && uv run uvicorn app.main:app --reload
```

DB 접속 정보 기본값은 [`.env.example`](.env.example)과 같다. 바꾸려면 `.env.example`을 `.env`로 복사해 수정하고, BE는 `DB_URL`·`DB_USERNAME`·`DB_PASSWORD` 환경 변수로 넘긴다. 로컬에 설치된 PostgreSQL과 겹치지 않도록 Docker DB는 5433 포트를 쓴다.

프로필 사진 등 파일 API(S3 Presigned URL)를 쓰려면 BE에 `S3_BUCKET`·`AWS_REGION`(기본 `ap-northeast-2`)과 AWS 자격 증명(`AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY`)을 넘긴다. 없어도 BE는 뜨고, 파일 주소가 필요한 요청만 500으로 실패한다.

## 검사 명령

MR 전에 파트별로 실행한다. CI도 같은 명령을 쓴다.

| 파트 | Format · Lint | Test · Coverage |
| --- | --- | --- |
| BE | `./gradlew spotlessCheck checkstyleMain checkstyleTest` (수정: `./gradlew spotlessApply`) | `./gradlew test` → `build/reports/jacoco/test/jacocoTestReport.xml` |
| FE | `npm run format:check && npm run lint && npm run typecheck` (수정: `npm run format`) | `npm run test:coverage` → `coverage/lcov.info` |
| AI | `uv run ruff format --check . && uv run ruff check . && uv run mypy` (수정: `uv run ruff format .`) | `uv run pytest --cov --cov-report=xml` → `coverage.xml` |

BE 테스트는 DB가 필요하므로 `docker compose up -d`를 먼저 실행한다.

## 팀원별 학습 기록

| 팀원 | 기록 |
| --- | --- |
| 박다빈 | [Readme.md](박다빈/Readme.md) |
| 박연수 | [Readme.md](박연수/Readme.md) |
| 이정복 | [Readme.md](이정복/Readme.md) |
| 이해준 | [Readme.md](이해준/Readme.md) |
| 전지웅 | [Readme.md](전지웅/Readme.md) |
| 한결 | [Readme.md](한결/Readme.md) |
