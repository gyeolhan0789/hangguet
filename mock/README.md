# A301 목 서버

실제 로직 없이 **API별 요청·응답(Swagger)과 예시 응답**을 제공하는 서버다. FE는 실제 백엔드가 완성되기 전 이 서버에 붙여 개발한다. DB를 쓰지 않는다.

API 명세의 기준은 이 서버의 Swagger와 [API 명세 문서](../docs/API-명세.md)다. Swagger에는 API별 요청·응답과 예시를, 명세 문서에는 공통 규약·업무 규칙·화면 대응·오류 코드·보류 목록을 둔다. 실제 백엔드(`backend/`)가 API를 구현하면 그 API는 `backend/`의 Swagger가, AI Service가 구현하면(API 명세 1장 처리 서버) 그 Service의 명세가 기준이 되고, 모두 구현되면 이 폴더는 `backend/`로 옮긴 뒤 지운다.

## 실행

```bash
./gradlew bootRun
```

- Swagger UI: http://localhost:8080/docs
- OpenAPI JSON: http://localhost:8080/v3/api-docs
- 상태 확인: http://localhost:8080/actuator/health

연습 기록은 시작일 기준이다. `GET /api/v1/interview-sessions?practiceDate=2026-10-21`로 자정을 넘겨 끝난 완료 면접·분석 중, `2026-10-20`으로 실패·총평 없는 완료 예시를 확인한다. 그 외 날짜는 빈 목록이다. 기본 `size=5`이며 페이지가 바뀌어도 날짜 전체 집계는 유지된다. `GET /api/v1/practice-logs?month=2026-10`은 마이페이지·스트릭에서도 시작일 기준으로 20·21일만 표시한다. 날짜 기준 선택 쿼리는 없으며 홈·통계·성장 리뷰도 같은 시작일 기준이다.

## 검사

`backend/`와 같은 포맷·정적 분석 규칙을 쓴다.

```bash
./gradlew spotlessCheck checkstyleMain checkstyleTest test
```

포맷 자동 수정은 `./gradlew spotlessApply`.

## Docker

```bash
docker build -t a301-mock .
```

```bash
docker run -p 8080:8080 -e MOCK_CORS_ALLOWED_ORIGINS=http://localhost:3000 a301-mock
```

## 환경 변수

| 이름 | 설명 | 기본값 |
|---|---|---|
| `MOCK_CORS_ALLOWED_ORIGINS` | API를 호출할 FE 주소. 쉼표로 여러 개 | `http://localhost:3000` |

리버스 프록시(예: `/mock` 경로) 뒤에서는 프록시가 `X-Forwarded-*` 헤더를 넘기면 Swagger가 프록시 주소로 요청을 보낸다.

## 배포

- 주소: https://hangguet.yobistory.com/mock/be/docs (API 기준 주소: `https://hangguet.yobistory.com/mock/be`)
- 방식: `mock/` 또는 `deploy/mock/` 변경이 `develop`에 병합되면 CI `mock-deploy` 잡이 미니PC에서 [`deploy/mock/compose.yml`](../deploy/mock/compose.yml)로 다시 빌드·실행한다. 배포 후 `/actuator/health`가 UP이 아니면 잡이 실패한다.
- 검사: 포맷·정적 분석·테스트(`mock-build`·`mock-test`)는 MR에서만 돈다. 병합 뒤 배포 파이프라인은 이미지 빌드(컴파일)와 Health 확인만 하므로, MR 파이프라인이 통과한 뒤 병합한다.
- 롤백: GitLab **Deployments → Environments → mock**에서 이전 배포를 Re-deploy 한다.
- Nginx 설정: [`deploy/mock/nginx.conf.example`](../deploy/mock/nginx.conf.example)
