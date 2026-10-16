# A301 목 서버

실제 로직 없이 **API 명세(Swagger)와 예시 응답**을 제공하는 서버다. FE는 실제 백엔드가 완성되기 전 이 서버에 붙여 개발한다. DB를 쓰지 않는다.

API 명세의 기준은 이 서버의 Swagger다. 실제 백엔드(`backend/`)가 API를 구현하면 그 API는 `backend/`의 Swagger가 기준이 되고, 모두 구현되면 이 폴더는 `backend/`로 옮긴 뒤 지운다.

## 실행

```bash
./gradlew bootRun
```

- Swagger UI: http://localhost:8080/swagger-ui.html
- OpenAPI JSON: http://localhost:8080/v3/api-docs
- 상태 확인: http://localhost:8080/actuator/health

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

