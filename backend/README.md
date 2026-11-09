# 한끗 백엔드

AI 모의면접 서비스 한끗의 REST API와 데이터 관리를 담당합니다. API 명세 1.x~9.x(인증·회원·홈·지원서·면접·결과·성장 리뷰·관리자·문의)를 구현합니다.

- API별 규칙·오류 코드: [API 명세](../docs/API-명세.md)
- 패키지·도메인·처리 흐름·Redis 키: [BE 설계](../docs/BE-설계.md)
- AI 작업·결과 메시지: [AI 명세](../docs/AI-명세.md)

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| 언어 | Java 21 |
| 프레임워크 | Spring Boot 4.1.1, Spring MVC |
| 인증·보안 | Spring Security, OAuth2 Resource Server(JWT) |
| 데이터 접근 | Spring Data JPA, Hibernate |
| 데이터베이스 | PostgreSQL 18 |
| DB 마이그레이션 | Flyway |
| 캐시·큐 | Redis, Spring Data Redis (리프레시 토큰, 멱등성, AI 작업·결과 큐, 면접 진행 상태) |
| 파일 | AWS SDK S3 (Presigned URL) |
| 면접방 | LiveKit Server SDK |
| API 문서 | springdoc-openapi, Swagger UI |
| 빌드 | Gradle |
| 테스트 | JUnit 5, Mockito, Spring Test, Spring Security Test |
| 코드 품질 | Spotless(Google Java Format AOSP), Checkstyle, JaCoCo, SonarQube |

## 로컬 실행

루트에서 `docker compose up -d`로 PostgreSQL(5433)과 Redis(6379)를 띄운 뒤 실행합니다.

```bash
./gradlew bootRun
```

- 상태 확인: http://localhost:8080/actuator/health
- Swagger UI: http://localhost:8080/docs

### 환경 변수

| 이름 | 필수 | 설명 | 기본값 |
| --- | --- | --- | --- |
| `JWT_SECRET` | ✅ | 액세스 토큰 서명 키(32바이트 이상) | 없음(없으면 기동 실패) |
| `INQUIRY_ENCRYPTION_KEY` | ✅ | 문의 제목·본문 암호화 키(Base64, 32바이트) | 없음(없으면 기동 실패) |
| `DB_URL` · `DB_USERNAME` · `DB_PASSWORD` | | PostgreSQL 접속 정보 | `jdbc:postgresql://localhost:5433/a301` · `a301` · `a301-local` |
| `REDIS_HOST` · `REDIS_PORT` | | Redis 접속 정보 | `localhost` · `6379` |
| `ADMIN_LOGIN_ID` · `ADMIN_PASSWORD` · `ADMIN_NAME` | | 셋 다 있으면 기동 때 관리자 계정을 만든다 | 없음 |
| `S3_BUCKET` · `AWS_REGION` | | 프로필 사진·녹화 저장소. 자격 증명은 `AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY` | `a301-local` · `ap-northeast-2` |
| `LIVEKIT_URL` · `LIVEKIT_PUBLIC_URL` · `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET` | | 면접방(LiveKit) 서버 주소·키 | 없음 |
| `LIVEKIT_EGRESS_S3_ACCESS_KEY` · `LIVEKIT_EGRESS_S3_SECRET` | | 녹화(Egress) 원본을 올릴 S3 키. LiveKit Cloud(개발)는 없으면 방 만들기가 거절됨. 셀프 호스팅은 Egress 서버 설정을 씀 | 없음 |
| `INTERVIEW_MAX_VIDEO` | | 화상 면접 동시 진행 상한(BE 설계 5.2). Soniox 연결 한도(10개)를 개발(2)과 운영(8)이 나눠 씀 | `8` |

로컬 예시 값은 루트 [`.env.example`](../.env.example)에 있습니다. S3·LiveKit 값이 없어도 기동하며, 그 기능이 필요한 요청만 실패합니다.

## 검사 명령

```bash
# 포맷·정적 분석 (자동 수정: ./gradlew spotlessApply)
./gradlew spotlessCheck checkstyleMain checkstyleTest

# 테스트 (PostgreSQL·Redis 필요) → build/reports/jacoco/test/jacocoTestReport.xml
./gradlew test redisIntegrationTest
```

`redisIntegrationTest`는 실제 HTTP·PostgreSQL·Redis로 인증 흐름을 확인하는 테스트(`redis-integration` 태그)만 따로 실행합니다. CI도 같은 명령을 씁니다.

## 프로젝트 구조

기능별 패키지를 두고, 각 기능 안은 계층별 하위 패키지로 나눕니다. 구현된 계층만 만듭니다. 클래스 단위 구조는 [BE 설계 2장](../docs/BE-설계.md#2-폴더--패키지-구조)을 봅니다.

```text
backend/
├─ config/checkstyle/              # 정적 분석 규칙
├─ src/main/java/com/ssafy/a301/
│  ├─ auth/                        # 1. 인증: 회원가입·로그인·재발급·로그아웃, JWT, Spring Security
│  ├─ user/                        # 2. 회원: 내 정보·닉네임·비밀번호·프로필 사진·탈퇴
│  ├─ home/                        # 3. 홈·통계·연습 달력
│  ├─ practice/                    # 연습 기록·스트릭 계산 (홈·성장 리뷰·회원·유지권이 함께 씀)
│  ├─ application/                 # 4. 지원서
│  ├─ interview/                   # 5. 면접 진행, AI 작업·결과 큐, 면접방(LiveKit)
│  ├─ result/                      # 6. 면접 결과·다시보기
│  ├─ growth/                      # 7. 성장 리뷰
│  ├─ admin/                       # 8. 관리자: 관리자 인증·공지·유지권·회원 검색·메트릭
│  ├─ inquiry/                     # 9. 문의 (제목·본문 암호화)
│  ├─ storage/                     # S3 파일 (Presigned URL)
│  ├─ common/                      # 여러 기능이 함께 쓰는 공통 코드 (오류 응답, 멱등성, 시간 처리 등)
│  └─ config/                      # Swagger·스케줄링 설정
├─ src/main/resources/
│  ├─ application.yml              # 애플리케이션 설정
│  └─ db/migration/                # Flyway 마이그레이션 (V1~)
├─ src/test/java/com/ssafy/a301/   # 단위·API·영속성·통합 테스트 (기능별 패키지)
├─ build.gradle                    # 의존성·빌드·검사 설정
└─ Dockerfile                      # 개발 서버 배포 이미지
```

| 하위 패키지 | 역할 |
| --- | --- |
| controller | HTTP 요청 수신, 입력 검증, 응답 반환 |
| service | 업무 규칙과 처리 흐름, 트랜잭션 |
| repository | DB·Redis 조회·저장 |
| dto | API 요청·응답 데이터 정의 |
| mapper | 엔티티를 응답 DTO로 변환 |
| domain | 엔티티, 상태 전이, enum 정의 |

## DB 마이그레이션

테이블은 Flyway로만 만들고 바꿉니다(`ddl-auto: validate`). 새 변경은 `src/main/resources/db/migration`에 다음 번호(`V{n}__설명.sql`)로 추가하고, 이미 배포된 파일은 고치지 않습니다. 다른 브랜치와 번호가 겹치지 않는지 병합 전에 확인합니다.
