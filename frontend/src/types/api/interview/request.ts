// 5. 면접 진행 요청. 기준: 웹 Swagger 5.1 ~ 5.15.

/** 면접관. DEVIL 악마 면접관 · COFFEE_CHAT 개발자 커피챗 · DUCK 오리 면접관 */
export type Persona = "DEVIL" | "COFFEE_CHAT" | "DUCK";

/** 면접 방식. VIDEO 화상 · CHAT 채팅 */
export type Mode = "VIDEO" | "CHAT";

/** 답변 입력 방식. VOICE 화상(음성) · TEXT 채팅 */
export type InputType = "VOICE" | "TEXT";

/**
 * 5.1 · 5.4 · 5.7 · 5.8 필수 헤더(웹 Swagger). 같은 요청을 다시 보낼 때는 처음 만든 키를 그대로 넘긴다.
 * 같은 키 · 같은 본문 = 처음 결과를 그대로 반환, 같은 키 · 다른 본문 = 409 IDEMPOTENCY_KEY_REUSED
 */
export interface IdempotencyHeaders {
  /** 멱등 키(UUID) */
  "Idempotency-Key": string;
}

/** 5.2~5.12 · 6.1~6.4 경로 값 */
export interface SessionPath {
  sessionId: number;
}

/** 답변 제출 경로 값 */
export interface QuestionPath extends SessionPath {
  questionId: number;
}

/** 5.1 POST /interview-sessions 본문 */
export interface SessionCreateRequest {
  /** 면접에 쓸 본인 지원서 id. 필수, 양수 */
  applicationId: number;
  /** 면접관(S04). 필수 */
  persona: Persona;
  /** 면접 방식(S05-1). 필수 */
  mode: Mode;
}

/** 5.7 POST …/questions/{questionId}/answer 본문 */
export interface AnswerRequest {
  /** 채팅 답변은 TEXT만 사용하며 화상 답변은 에이전트가 저장한다. */
  inputType: "TEXT";
  /** 채팅 답변 글. 필수, 1~1,000자. */
  content: string;
}

/** 5.8 POST …/end 본문. 선택이며 없으면 본문 없이 보낸다 */
export interface SessionEndRequest {
  /** 화상 면접 동안 면접관을 바라본 시간 비율(%, 0~100). 화면이 브라우저에서 잰 값. 재지 못했거나 채팅이면 보내지 않는다 */
  gazeRatio?: number;
}

// 면접 조회·질문 조회·결과 재생성에는 요청 본문을 사용하지 않는다.
// 면접 시작은 본문 없이 IdempotencyHeaders만 전송한다.

/** 5.13 GET /interview-sessions 쿼리(연습 면접 목록) */
export interface SessionListQuery {
  /** 한국 시간의 면접 시작 날짜. 필수, `YYYY-MM-DD` */
  practiceDate: string;
  /** 0부터. 기본 0 */
  page?: number;
  /** 1~20. 기본 5 */
  size?: number;
}

/** 5.15 GET /interview-sessions/calendar 쿼리(월별 연습 면접 횟수) */
export interface SessionCalendarQuery {
  /** 조회 월. 필수, `YYYY-MM`(연도 0001~9999) */
  month: string;
}
