// API 공통 타입. 기준: 웹 Swagger(https://hangguet.yobistory.com/mock/be/v3/api-docs) 공통 규약 · ProblemDetail.
// 정수는 number, 날짜는 문자열로 받는다.

/** 날짜 `YYYY-MM-DD`(한국 시간). Swagger format date */
export type LocalDate = string;

/** 일시 ISO 8601, 오프셋 포함(`2026-10-15T12:00:00+09:00`). Swagger format date-time */
export type OffsetDateTime = string;

/**
 * 웹 Swagger의 오류 code. 실패 응답의 `code`로 오고 화면은 이 값으로 분기한다.
 * 공통 오류(401 UNAUTHORIZED · TOKEN_EXPIRED, 400 VALIDATION_FAILED, 500 INTERNAL_ERROR)는 API별 표기가 생략돼 있다.
 */
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
  | "COVER_LETTER_CHECK_UNAVAILABLE"
  // 면접 진행
  | "SESSION_NOT_FOUND"
  | "QUESTION_NOT_FOUND"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_SESSION_STATE"
  | "PLAN_NOT_READY"
  | "PLAN_NOT_FAILED"
  | "ANSWER_ALREADY_SUBMITTED"
  | "STT_UNAVAILABLE"
  | "TTS_UNAVAILABLE"
  // 결과 · 성장 리뷰
  | "RECORDING_ALREADY_EXISTS"
  | "RESULT_NOT_READY"
  | "NO_RESULT"
  | "GROWTH_REVIEW_NOT_FOUND"
  // 문의
  | "INQUIRY_NOT_FOUND"
  | "INQUIRY_CLOSED";

/** 400 VALIDATION_FAILED의 칸별 실패 사유 */
export interface FieldError {
  /** 요청 필드명 */
  field?: string;
  /** 요구 조건 */
  reason?: string;
}

/**
 * 실패 응답(RFC 9457) + `code`. Content-Type은 `application/problem+json`.
 * `type`은 기본값 about:blank라 생략된다. Swagger에 필수로 정한 필드가 없어 모두 선택이다.
 */
export interface ProblemDetail {
  /** HTTP 상태 이름 */
  title?: string;
  /** HTTP 상태 코드 */
  status?: number;
  /** 사용자에게 보여 줄 문구 */
  detail?: string;
  /** 요청 경로 */
  instance?: string;
  /** 오류 종류. 화면 분기는 이 값으로 한다 */
  code?: ErrorCode | (string & {});
  /** 400 VALIDATION_FAILED일 때만. 칸별 실패 사유 */
  errors?: FieldError[];
}

/** 페이지 목록 응답(웹 Swagger 4.3 · 4.6 · 5.13 · 7.2 · 9.2). `number`는 0부터 */
export interface Page<T> {
  content: T[];
  page: {
    size: number;
    number: number;
    totalElements: number;
    totalPages: number;
  };
}

/** 페이지 목록 요청 쿼리(4.3 · 4.6 · 7.2). 기본값은 API마다 다르다 */
export interface PageQuery {
  /** 0 이상, 기본 0 */
  page?: number;
  /** 1~20 */
  size?: number;
}

/** 파일 업로드 주소 응답(웹 Swagger 2.4 · 5.6 · 6.1 '응답 형식은 2.4와 같다'). 브라우저가 uploadUrl로 S3에 직접 PUT한다. */
export interface UploadUrlResponse {
  /** 파일을 PUT할 임시 주소 */
  uploadUrl: string;
  /** 올린 파일의 키. 등록 API에 그대로 보낸다 */
  objectKey: string;
  /** uploadUrl 만료 일시 */
  expiresAt: OffsetDateTime;
}
