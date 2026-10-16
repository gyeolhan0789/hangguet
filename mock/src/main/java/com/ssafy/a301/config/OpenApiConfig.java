package com.ssafy.a301.config;

import com.ssafy.a301.common.ErrorExamples;
import io.swagger.v3.core.util.Json;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.examples.Example;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import java.util.Map;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Swagger 문서의 기본 정보, 공통 규약, 공통 오류 응답, 목록 정렬을 정한다. */
@Configuration
public class OpenApiConfig {

    private static final String DESCRIPTION =
            """
            한끗(A301) API 명세. 화면 번호(S00~S09·C01)는 화면 설계 기준

            ### 공통 규약
            - **기본 경로** `/api/v1`. Resource는 복수 명사·kebab-case, JSON 필드는 camelCase, enum은 UPPER_SNAKE_CASE
            - **일시** ISO 8601 오프셋 포함(`2026-10-15T12:00:00+09:00`), **날짜** `YYYY-MM-DD`(한국 시간)
            - **인증** `Authorization: Bearer {accessToken}`. 자물쇠 없는 API만 토큰 없이 호출. 회원은 토큰으로만 식별(본문·경로로 회원 id를 받지 않음)
            - 다른 회원의 리소스는 존재 여부를 숨기기 위해 **404**. 탈퇴한 회원의 데이터는 조회되지 않음
            - **성공 응답** 래퍼 없이 리소스 그대로. 본문 없는 성공은 204. 페이지 목록은 `{ content, page: { size, number(0부터), totalElements, totalPages } }`
            - **실패 응답** RFC 9457 ProblemDetail(`title`·`status`·`detail`·`instance`, `type`은 기본값 `about:blank`라 생략) + `code`. 화면 분기는 `code`로 한다. 400 `VALIDATION_FAILED`는 `errors[{ field, reason }]` 추가
            - **모든 API 공통 오류** 401 `UNAUTHORIZED`(토큰 없음·위조·탈퇴) · 401 `TOKEN_EXPIRED`(만료 → 토큰 재발급 후 재요청) · 400 `VALIDATION_FAILED` · 500 `INTERNAL_ERROR`(문구 고정 "잠시 후 다시 시도해 주세요.")
            - **멱등성** 면접 만들기·시작·답변 제출·끝내기는 `Idempotency-Key: {UUID}` 필수. 같은 키·같은 본문 = 처음 결과 반환, 같은 키·다른 본문 = 409 `IDEMPOTENCY_KEY_REUSED`, 헤더 없음 = 400
            - **파일** 음성·영상·사진은 Presigned URL로 브라우저가 S3에 직접 올리고 받음. API·WebSocket으로 파일을 보내지 않음
            - **연습 면접** 답변 1개 이상으로 끝난 면접(`ANALYZING`·`COMPLETED`·`FAILED`, `ABORTED` 제외). 스트릭·면접 수·연습 시간은 모두 이 기준

            ### 실시간 (WebSocket) — Swagger에 표시되지 않음
            `/ws/interview-sessions/{sessionId}`. 연결 직후 첫 메시지로 액세스 토큰 전송(B-11). 공통 필드 `type`, `sessionId`, `sequence`(보내는 쪽마다 1씩 증가), `sentAt`. 놓치면 REST로 복구.

            | type | 방향 | 언제 | 본문 | 복구 |
            |---|---|---|---|---|
            | `PLAN_READY` · `PLAN_FAILED` | 서버→화면 | 플랜 생성 완료 · 실패 | 없음 | 면접 조회 |
            | `SESSION_STATUS_CHANGED` | 서버→화면 | `status`·`planProgress`·`analysisStep` 변경 | 바뀐 값 | 면접 조회 |
            | `QUESTION_READY` | 서버→화면 | 다음 질문 준비 | `question: { id, seq, content }` | 지금 질문 |
            | `REACTION` | 서버→화면 | 면접관 반응(반응 로직 모듈 판단) | `reaction` (아래 두 케이스) | 없음 |
            | `LISTENING_STARTED` | 화면→서버 | 답변 듣기 시작 | `questionId` | - |
            | `ANSWER_COMPLETED` | 화면→서버 | [답변 완료] (반응 중지) | `questionId` | - |

            ```json
            { "type": "QUESTION_READY", "sessionId": 55, "sequence": 12, "sentAt": "2026-10-15T12:10:05+09:00",
              "question": { "id": 304, "seq": 4, "content": "백엔드 직무에 지원한 이유는?" } }
            { "type": "SESSION_STATUS_CHANGED", "sessionId": 55, "sequence": 41, "sentAt": "2026-10-15T12:18:06+09:00",
              "status": "ANALYZING", "planProgress": null, "analysisStep": "SCORING" }
            ```

            #### `REACTION` — 면접관 방식별 두 케이스
            반응 판단·전달(반응 로직 모듈 → BE)은 같고, 화면이 값을 쓰는 방법이 다르다. 필드는 면접관 표현 모듈 반응 이벤트 계약(`interviewer-avatar/architecture.md` 2장)을 따른다.

            | | 케이스 1. 코드로 변형 (후보 2개) | 케이스 2. 표정별 이미지 (후보 1개) |
            |---|---|---|
            | 동작 | BE 값에 따라 얼굴을 코드로 연속 변형 | 표정별로 저장한 이미지 중 하나를 표시 |
            | 쓰는 `reaction.type` | `state` · `expression` · `gesture` · `attitude` | `state` · `expression` |
            | `intensity`(세기) · `attitude`(태도) · `gesture`(동작) | 사용 | 무시 |
            | `durationMs` | 순간 표정 유지 시간 | 이미지 표시 시간. 끝나면 `state` 이미지로 복귀 |

            | 값 | 케이스 1 | 케이스 2 |
            |---|---|---|
            | `state`: `idle` · `listening` · `thinking` · `speaking` | 자세·시선·입 움직임으로 표현 | 상태별 기본 이미지 |
            | `expression`: `smile` · `frown` · `smirk` | 세기에 따라 연속 변형 | 표정별 이미지 |
            | `gesture`: `small_nod` · `nod` · `tilt` | 끄덕·갸웃 동작 | 무시 |
            | `attitude`: `interest` · `trust` · `tension` (0~1) | 표정이 서서히 바뀜 | 무시 |

            ```json
            // 케이스 1
            { "type": "REACTION", "sessionId": 55, "sequence": 31, "sentAt": "2026-10-15T12:07:02+09:00",
              "reaction": { "type": "expression", "expression": "smile", "intensity": 0.6, "durationMs": 1200, "ttlMs": 1500, "source": "server" } }
            // 케이스 2
            { "type": "REACTION", "sessionId": 55, "sequence": 31, "sentAt": "2026-10-15T12:07:02+09:00",
              "reaction": { "type": "expression", "expression": "smile", "durationMs": 1200, "ttlMs": 1500, "source": "server" } }
            ```

            채팅 면접은 음성이 없어 기본값(무표정, `state`만). 공통: `ttlMs`가 지났거나 `ANSWER_COMPLETED` 뒤 도착한 반응, 정의되지 않은 값은 버린다. 반응 로직 모듈은 면접관 방식을 몰라도 된다(케이스 2는 쓰지 않는 필드를 무시). 실시간 답변 자막은 브라우저가 STT 회사에서 직접 받는다(5.10).

            ### 오류 코드

            | code | 상태 | API |
            |---|---|---|
            | `UNAUTHORIZED` · `TOKEN_EXPIRED` | 401 | 인증 필요한 전부 |
            | `VALIDATION_FAILED` | 400 | 본문·쿼리가 있는 전부 |
            | `INTERNAL_ERROR` | 500 | 전부 |
            | `LOGIN_FAILED` · `REFRESH_TOKEN_INVALID` | 401 | 1.3 · 1.4 |
            | `AGREEMENT_REQUIRED` · `EMAIL_DUPLICATED` | 400 · 409 | 1.2 |
            | `PASSWORD_MISMATCH` | 400 | 2.3, 2.7 |
            | `FILE_NOT_FOUND` | 404 | 2.5, 5.7, 6.2 |
            | `APPLICATION_NOT_FOUND` · `APPLICATION_IN_USE` | 404 · 409 | 4.x, 5.1 |
            | `SESSION_NOT_FOUND` · `QUESTION_NOT_FOUND` | 404 | 5.x, 6.x |
            | `IDEMPOTENCY_KEY_REUSED` | 409 | 5.1, 5.4, 5.7, 5.8 |
            | `INVALID_SESSION_STATE` | 409 | 5.4~5.10, 6.1 |
            | `PLAN_NOT_READY` · `PLAN_NOT_FAILED` | 409 | 5.4 · 5.3 |
            | `ANSWER_ALREADY_SUBMITTED` | 409 | 5.7 |
            | `STT_UNAVAILABLE` | 503 | 5.10 |
            | `RECORDING_ALREADY_EXISTS` | 409 | 6.2 |
            | `RESULT_NOT_READY` · `NO_RESULT` | 409 | 6.3, 6.4 |
            | `GROWTH_REVIEW_NOT_FOUND` | 404 | 7.1 |
            | `QUESTION_GENERATING` | 202(오류 아님) | 5.5 |

            ### 보류 · 확인 필요 (B)

            | # | 내용 | 영향 | 담당 |
            |---|---|---|---|
            | B-1 | 질문 음성(TTS) 전달: TTS 회사(일레븐랩스·타입캐스트). 1회용 토큰 지원 시 5.10과 같은 방식 | 5.4, 5.5, `QUESTION_READY` | 보류 |
            | B-2 | STT 회사: 일레븐랩스 · Soniox 중 미정 | 5.10 | BE |
            | B-3 | 면접 전체 질문 수("질문 3 / 5"). 고정이면 상수, 바뀌면 컬럼 필요 | 5.2, 5.7 | 면접 AI 모듈 |
            | B-4 | 점수 → 좋아요·보통·아쉬워요 경계값 | 6.3, 6.4, 7.1 | 협의 |
            | B-5 | 오늘 완료 기준(현재: 답변 1개 이상인 면접 종료). 성장 리뷰까지 봐야 완료인지 | 3.1, 5.8 | 화면 |
            | B-6 | 탈퇴 시 삭제 범위, 녹화 보관 기간 | 2.7, 6.x | 약관 |
            | B-7 | 설문 노출·참여, 재방문 지표(D1·D3·D7) 저장 | 7.1 | 이벤트 로깅 |
            | B-8 | 면접관별 반응 케이스(코드 변형 / 표정 이미지), 케이스 2 이미지 목록 | `REACTION` | 면접관 표현 모듈 |
            | B-9 | 면접 플랜(예상 질문·평가 기준) 저장 위치. 평가 기준이 고정 4개면 저장 불필요 | 5.1~5.4 | 면접 AI 모듈 |
            | B-10 | 자소서 검증: 충돌 1개당 차감 점수, "명확한 충돌" 판단 기준 | 6.3, 7.1 | 면접 AI 모듈 |
            | B-11 | WebSocket 인증 방식(첫 메시지 토큰 / 쿠키 / 1회용 연결 티켓) | WebSocket | BE |

            **MVP 제외(API 없음)**: 비밀번호 찾기, 업적, 연습 알림 메일, 개발자 콘솔

            ### 이 목 서버
            실제 로직 없이 명세의 예시 응답을 돌려준다. 인증·DB는 없다.
            """;

    @Bean
    public OpenAPI openApi() {
        return new OpenAPI()
                .info(new Info().title("한끗 A301 API").version("v0.1").description(DESCRIPTION))
                .components(
                        new Components()
                                .addSecuritySchemes(
                                        "bearer",
                                        new SecurityScheme()
                                                .type(SecurityScheme.Type.HTTP)
                                                .scheme("bearer")
                                                .bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList("bearer"));
    }

    /** 모든 API 공통 응답(401·400·500)을 각 API에 붙인다. 이미 적은 상태 코드는 건드리지 않는다. */
    @Bean
    public OpenApiCustomizer commonErrorResponses() {
        return openApi -> {
            openApi.getComponents().addSchemas("ProblemDetail", problemDetailSchema());
            if (openApi.getPaths() == null) {
                return;
            }
            for (PathItem path : openApi.getPaths().values()) {
                for (Operation op : path.readOperations()) {
                    addCommonErrors(op);
                }
            }
        };
    }

    private static void addCommonErrors(Operation op) {
        ApiResponses responses = op.getResponses();
        boolean secured = op.getSecurity() == null || !op.getSecurity().isEmpty();
        boolean hasInput =
                op.getRequestBody() != null
                        || (op.getParameters() != null && !op.getParameters().isEmpty());
        addIfAbsent(
                responses,
                "401",
                secured,
                "인증 실패 · 만료",
                Map.of(
                        "UNAUTHORIZED", ErrorExamples.UNAUTHORIZED,
                        "TOKEN_EXPIRED", ErrorExamples.TOKEN_EXPIRED));
        addIfAbsent(
                responses,
                "400",
                hasInput,
                "입력값 오류",
                Map.of("VALIDATION_FAILED", ErrorExamples.VALIDATION_FAILED));
        addIfAbsent(
                responses,
                "500",
                true,
                "처리 실패",
                Map.of("INTERNAL_ERROR", ErrorExamples.INTERNAL_ERROR));
    }

    /** Swagger 목록을 명세 번호(summary 앞의 "5.10" 등) 순으로 정렬한다. */
    @Bean
    public OpenApiCustomizer sortByApiNumber() {
        return openApi -> {
            if (openApi.getPaths() == null) {
                return;
            }
            Paths sorted = new Paths();
            openApi.getPaths().entrySet().stream()
                    .sorted((x, y) -> compare(apiNumber(x.getValue()), apiNumber(y.getValue())))
                    .forEach(e -> sorted.addPathItem(e.getKey(), e.getValue()));
            openApi.setPaths(sorted);
        };
    }

    private static void addIfAbsent(
            ApiResponses responses,
            String status,
            boolean applies,
            String description,
            Map<String, String> examples) {
        if (applies && !responses.containsKey(status)) {
            responses.addApiResponse(status, problem(description, examples));
        }
    }

    private static ApiResponse problem(String description, Map<String, String> examples) {
        MediaType mediaType =
                new MediaType().schema(new Schema<>().$ref("#/components/schemas/ProblemDetail"));
        examples.forEach(
                (name, json) -> {
                    try {
                        mediaType.addExamples(
                                name, new Example().value(Json.mapper().readTree(json)));
                    } catch (Exception e) {
                        throw new IllegalStateException("오류 예시 JSON이 잘못됨: " + name, e);
                    }
                });
        return new ApiResponse()
                .description(description)
                .content(new Content().addMediaType(ErrorExamples.PROBLEM, mediaType));
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static Schema problemDetailSchema() {
        return typed("object")
                .description("실패 응답(RFC 9457). `type`은 기본값 about:blank라 생략")
                .addProperty("title", typed("string").description("HTTP 상태 이름"))
                .addProperty("status", typed("integer").description("HTTP 상태 코드"))
                .addProperty("detail", typed("string").description("사용자에게 보여 줄 문구"))
                .addProperty("instance", typed("string").description("요청 경로"))
                .addProperty("code", typed("string").description("오류 종류. 화면 분기는 이 값으로 한다"))
                .addProperty(
                        "errors",
                        typed("array")
                                .description("400 VALIDATION_FAILED일 때만. 칸별 실패 사유")
                                .items(
                                        typed("object")
                                                .addProperty(
                                                        "field",
                                                        typed("string").description("요청 필드명"))
                                                .addProperty(
                                                        "reason",
                                                        typed("string").description("요구 조건"))));
    }

    // OpenAPI 3.1 문서는 type 대신 types로 써야 JSON에 나간다
    @SuppressWarnings("rawtypes")
    private static Schema typed(String type) {
        return new Schema<>().types(Set.of(type));
    }

    private static double[] apiNumber(PathItem item) {
        return item.readOperations().stream()
                .map(op -> op.getSummary() == null ? "99.99" : op.getSummary().split(" ")[0])
                .map(n -> n.split("\\."))
                .map(
                        p ->
                                new double[] {
                                    Double.parseDouble(p[0]),
                                    p.length > 1 ? Double.parseDouble(p[1]) : 0
                                })
                .min(OpenApiConfig::compare)
                .orElse(new double[] {99, 99});
    }

    private static int compare(double[] a, double[] b) {
        return a[0] != b[0] ? Double.compare(a[0], b[0]) : Double.compare(a[1], b[1]);
    }
}
