// API 공통 타입. 기준: mock 서버 소스(mock/src/main/java/com/ssafy/a301)와 Swagger, docs/API-명세.md 1장.
// 자바 long·int·Integer는 number, 날짜는 문자열로 받는다.

/** 날짜 `YYYY-MM-DD`(한국 시간). 자바 LocalDate */
export type LocalDate = string;

/** 일시 ISO 8601, 오프셋 포함(`2026-10-15T12:00:00+09:00`). 자바 OffsetDateTime */
export type OffsetDateTime = string;

/** mock ErrorCode. 실패 응답의 `code`로 오고 화면은 이 값으로 분기한다. */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "TOKEN_EXPIRED"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR"
  // 인증 · 회원
  | "LOGIN_FAILED"
  | "REFRESH_TOKEN_INVALID"
  | "AGREEMENT_REQUIRED"
  | "EMAIL_DUPLICATED"
  | "PASSWORD_MISMATCH"
  | "FILE_NOT_FOUND"
  // 지원서
  | "APPLICATION_NOT_FOUND"
  | "APPLICATION_IN_USE"
  // 면접 진행
  | "SESSION_NOT_FOUND"
  | "QUESTION_NOT_FOUND"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_SESSION_STATE"
  | "PLAN_NOT_READY"
  | "PLAN_NOT_FAILED"
  | "ANSWER_ALREADY_SUBMITTED"
  | "STT_UNAVAILABLE"
  // 결과 · 성장 리뷰
  | "RECORDING_ALREADY_EXISTS"
  | "RESULT_NOT_READY"
  | "NO_RESULT"
  | "GROWTH_REVIEW_NOT_FOUND";

/**
 * Spring이 직접 만드는 실패의 code(GlobalExceptionHandler.defaultCode). 없는 주소 · 지원하지 않는 메서드 등.
 * 400·401·5xx는 VALIDATION_FAILED · UNAUTHORIZED · INTERNAL_ERROR로 바뀌고, 나머지는 HTTP 상태 이름이 온다.
 */
export type HttpStatusCode = "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "UNSUPPORTED_MEDIA_TYPE";

/** VALIDATION_FAILED의 칸별 오류. field는 요청 필드 경로(예: `password`, `agreements[0].termsVersion`) */
export interface FieldError {
  field: string;
  reason: string;
}

/**
 * 실패 응답: RFC 9457 ProblemDetail + `code`. Content-Type은 `application/problem+json`.
 * `type`은 기본값 `about:blank`라 오지 않는다(API 명세 1장).
 */
export interface ProblemDetail {
  title: string;
  status: number;
  /** 사용자에게 보여 줄 문구 */
  detail: string;
  /** 요청 경로 */
  instance: string;
  code: ErrorCode | HttpStatusCode | (string & {});
  /** 400 VALIDATION_FAILED에서만 온다 */
  errors?: FieldError[];
}

/** 페이지 목록 응답(WebConfig VIA_DTO). `number`는 0부터 */
export interface Page<T> {
  content: T[];
  page: {
    size: number;
    number: number;
    totalElements: number;
    totalPages: number;
  };
}

/** 페이지 목록 요청 쿼리(4.3 · 7.2). 기본값은 API마다 다르다 */
export interface PageQuery {
  /** 0 이상, 기본 0 */
  page?: number;
  /** 1~20 */
  size?: number;
}

/** 파일 업로드 주소 응답(2.4 · 5.6 · 6.1, mock UserDtos.UploadUrlResponse). 브라우저가 uploadUrl로 S3에 직접 PUT한다. */
export interface UploadUrlResponse {
  /** 파일을 PUT할 임시 주소 */
  uploadUrl: string;
  /** 올린 파일의 키. 등록 API에 그대로 보낸다 */
  objectKey: string;
  /** uploadUrl 만료 일시 */
  expiresAt: OffsetDateTime;
}
