# 한끗 백엔드

AI 모의면접 서비스 한끗의 REST API와 데이터 관리를 담당합니다.

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| 언어 | Java 21 |
| 프레임워크 | Spring Boot 4.1.1, Spring MVC |
| 인증·보안 | Spring Security, JWT |
| 데이터 접근 | Spring Data JPA, Hibernate |
| 데이터베이스 | PostgreSQL 18 |
| 토큰 저장소 | Redis, Spring Data Redis |
| DB 마이그레이션 | Flyway |
| API 문서 | springdoc-openapi, Swagger UI |
| 빌드 | Gradle |
| 테스트 | JUnit 5, Mockito, Spring Test, Spring Security Test |
| 코드 품질 | Spotless, Google Java Format, Checkstyle, JaCoCo, SonarQube |

## 프로젝트 구조

기능별 패키지를 유지하고 내부는 계층별 하위 패키지로 나눕니다. 구현된 계층만 만들며, 인증 DTO는 개별 record 파일로 관리합니다. 다른 기능의 기존 DTO 묶음은 각 `dto` 패키지에 유지합니다.

```text
backend/
├─ config/checkstyle/                  # 정적 분석 규칙
├─ gradle/wrapper/                     # Gradle Wrapper
├─ src/
│  ├─ main/
│  │  ├─ java/com/ssafy/a301/
│  │  │  ├─ A301Application.java        # 애플리케이션 진입점
│  │  │  ├─ auth/
│  │  │  │  ├─ controller/             # 인증 REST API
│  │  │  │  ├─ service/                # 회원가입·로그인·재발급·로그아웃
│  │  │  │  ├─ dto/                    # 개별 요청·응답 record
│  │  │  │  ├─ jwt/                    # JWT 발급·인증 설정값
│  │  │  │  ├─ repository/             # 리프레시 토큰 저장소
│  │  │  │  └─ config/                 # Spring Security 설정
│  │  │  ├─ user/                      # dto·mapper·repository·domain
│  │  │  ├─ application/               # 지원서: dto·mapper·domain
│  │  │  ├─ interview/                 # 면접: dto·mapper·domain
│  │  │  ├─ result/                    # 결과·다시보기: dto·mapper
│  │  │  ├─ home/                      # 홈·연습 기록: dto·mapper·domain
│  │  │  ├─ growth/dto/                # 성장 리뷰 응답
│  │  │  ├─ common/error/              # 공통 오류 코드·예외·오류 응답 처리
│  │  │  └─ config/                    # Swagger 공통 설정
│  │  └─ resources/
│  │     ├─ application.yml            # 애플리케이션 설정
│  │     └─ db/migration/              # Flyway DB 마이그레이션
│  └─ test/java/com/ssafy/a301/         # 단위·API·영속성 테스트
├─ build.gradle                        # 의존성·빌드·검사 설정
└─ settings.gradle                     # Gradle 프로젝트 설정
```

| 구성 요소 | 역할 |
| --- | --- |
| controller | HTTP 요청 수신, 입력 검증, 응답 반환 |
| service | 업무 규칙과 처리 흐름 구현 |
| repository | 데이터베이스 조회·저장 |
| dto | API 요청·응답 데이터 정의 |
| mapper | 엔티티를 응답 DTO로 변환 |
| domain | 엔티티, 상태 전이, enum 정의 |
