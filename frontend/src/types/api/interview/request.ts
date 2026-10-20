// 5. 면접 진행 요청. 기준: mock InterviewDtos · InterviewSessionController.

/** 면접관. DEVIL 악마 면접관 · COFFEE_CHAT 개발자 커피챗 */
export type Persona = "DEVIL" | "COFFEE_CHAT";

/** 면접 방식. VIDEO 화상 · CHAT 채팅 */
export type Mode = "VIDEO" | "CHAT";

/** 답변 입력 방식. VOICE 화상(음성) · TEXT 채팅 */
export type InputType = "VOICE" | "TEXT";

/** 답변 녹음 형식 */
export type AnswerAudioContentType = "audio/webm" | "audio/ogg" | "audio/mp4";

/**
 * 5.1 · 5.4 · 5.7 · 5.8 필수 헤더. 같은 요청을 다시 보낼 때는 처음 만든 키를 그대로 넘긴다.
 * 같은 키 · 같은 본문 = 처음 결과, 같은 키 · 다른 본문 = 409 IDEMPOTENCY_KEY_REUSED, 헤더 없음 = 400
 */
export interface IdempotencyHeaders {
  /** UUID 형식. 아니면 400 */
  "Idempotency-Key": string;
}

/** 5.2~5.11 · 6.1~6.4 경로 값 */
export interface SessionPath {
  sessionId: number;
}

/** 5.6 · 5.7 · 5.11 경로 값 */
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

/** 5.6 POST …/questions/{questionId}/answer-audio/upload-url 본문 */
export interface AnswerAudioUploadUrlRequest {
  /** 녹음 형식. 필수 */
  contentType: AnswerAudioContentType;
}

/** 5.7 POST …/questions/{questionId}/answer 본문 */
export interface AnswerRequest {
  /** VOICE(화상) | TEXT(채팅). 면접 방식(mode)과 같아야 한다. 필수 */
  inputType: InputType;
  /** 답변 글. 필수. 채팅은 입력한 글(1~1,000자), 화상은 실시간 음성 인식(5.10)의 최종 결과(1~10,000자) */
  content: string;
  /** 답변 음성 키. VOICE일 때 필수. 5.6에서 받은 objectKey */
  audioObjectKey?: string | null;
}

/** 5.11 POST …/questions/{questionId}/reactions 본문 */
export interface ReactionRequest {
  /** 답변 안에서 몇 번째 문장인지(1부터). 필수 */
  seq: number;
  /** 음성 인식이 확정한 문장. 필수, 1~1,000자 */
  text: string;
  /** 문장을 말한 뒤 쉰 시간(밀리초). 필수, 0 이상 */
  pauseMs: number;
}

// 5.2 · 5.3 · 5.5 · 5.9 · 5.10은 본문이 없다. 5.4 · 5.8은 본문 없이 IdempotencyHeaders만 보낸다.
