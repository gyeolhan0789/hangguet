import type { VideoAnswerResult } from "@/components/interview/video-answer-contract";
import type { AnswerAudioContentType, TranscriptToken } from "@/types/api";

import { createAnswerAudioUploadUrl, submitVideoAnswer, type VideoAnswerBody } from "./actions";
import type { SpeechActionFailure } from "./speech-failure";

// 기준: API 명세 5.6(수신한 uploadUrl로 브라우저가 S3에 직접 PUT, objectKey는 5.7 audioObjectKey, expiresAt 이후 주소 만료) · Swagger 5.7 답변 제출
// (202 isLastQuestion · 404 FILE_NOT_FOUND · 409 ANSWER_ALREADY_SUBMITTED · IDEMPOTENCY_KEY_REUSED) · API 명세 5.7(Idempotency-Key)
// 화상 답변 제출 순서(답변 음성 PUT → 5.7)와 재전송 규칙이다. 화면 상태는 처리하지 않는다.

/** 5.6에서 수신한 업로드 정보와 녹음 형식 */
export interface AnswerUpload {
  uploadUrl: string;
  objectKey: string;
  /** 업로드 주소 만료 일시(ISO 8601) */
  expiresAt: string;
  contentType: AnswerAudioContentType;
}

/**
 * 한 번 생성해 202를 수신할 때까지 고정하는 제출 데이터(키 · 본문 · 답변 음성). 다시 계산하면 같은 키 · 다른 본문이 되어
 * 409 IDEMPOTENCY_KEY_REUSED가 반환되므로 다시 전송할 때도 이 값을 그대로 사용한다.
 */
export interface PreparedAnswer {
  readonly sessionId: number;
  readonly questionId: number;
  readonly idempotencyKey: string;
  readonly body: VideoAnswerBody;
  readonly audio: Blob;
  readonly upload: AnswerUpload;
  /** 답변 음성을 이미 업로드했는지. FILE_NOT_FOUND면 false로 되돌려 PUT부터 다시 수행한다 */
  readonly uploaded: boolean;
  /** 업로드 주소를 다시 발급받아야 하는지. PUT이 실패하면 true로 설정한다 */
  readonly reissueUpload: boolean;
}

export type SubmitOutcome =
  | VideoAnswerResult
  /** 다시 전송할 때는 next를 전달한다. PUT 실패면 failure가 null이다 */
  | { kind: "failed"; next: PreparedAnswer; failure: SpeechActionFailure | null };

export function prepareAnswer(input: {
  sessionId: number;
  questionId: number;
  content: string;
  tokens: TranscriptToken[] | null;
  audio: Blob;
  upload: AnswerUpload;
}): PreparedAnswer {
  return {
    sessionId: input.sessionId,
    questionId: input.questionId,
    idempotencyKey: crypto.randomUUID(),
    body: { content: input.content, audioObjectKey: input.upload.objectKey, tokens: input.tokens },
    audio: input.audio,
    upload: input.upload,
    uploaded: false,
    reissueUpload: false,
  };
}

/**
 * 주소가 만료되었거나 직전 PUT이 실패했으면 5.6을 다시 호출해 uploadUrl · expiresAt을 갱신한다.
 * objectKey는 질문마다 고정되므로 본문의 audioObjectKey와 Idempotency-Key는 그대로 유효하다.
 * 재발급에 실패하면(예: 면접 종료 후 409 INVALID_SESSION_STATE) 화면이 실패 이유를 표시할 수 있도록 5.6의 code·status를 반환한다.
 */
async function ensureUploadUrl(
  prepared: PreparedAnswer,
): Promise<AnswerUpload | SpeechActionFailure> {
  const { upload } = prepared;
  if (!prepared.reissueUpload && Date.now() < Date.parse(upload.expiresAt)) return upload;
  const result = await createAnswerAudioUploadUrl(
    prepared.sessionId,
    prepared.questionId,
    upload.contentType,
  );
  if (!result.ok) return result;
  return { ...upload, uploadUrl: result.uploadUrl, expiresAt: result.expiresAt };
}

/** Presigned URL은 서명할 때와 같은 Content-Type으로 업로드해야 한다(profile-photo-row.tsx와 같은 방식) */
async function putAudio(upload: AnswerUpload, audio: Blob): Promise<boolean> {
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": upload.contentType },
    body: audio,
  }).catch(() => null);
  return response?.ok === true;
}

/**
 * 답변 음성을 업로드하고 5.7을 제출한다. 이미 업로드했으면 5.7부터 같은 키 · 같은 본문으로 다시 전송한다.
 * PUT이 실패하면 다음 시도는 업로드 주소를 다시 발급받고, FILE_NOT_FOUND면 다음 시도는 PUT부터 수행한다.
 */
export async function submitPreparedAnswer(prepared: PreparedAnswer): Promise<SubmitOutcome> {
  let current = prepared;
  if (!current.uploaded) {
    const upload = await ensureUploadUrl(current);
    if ("ok" in upload) return { kind: "failed", next: current, failure: upload };
    current = { ...current, upload, reissueUpload: false };
    if (!(await putAudio(upload, current.audio))) {
      return { kind: "failed", next: { ...current, reissueUpload: true }, failure: null };
    }
    current = { ...current, uploaded: true };
  }
  const result = await submitVideoAnswer(
    current.sessionId,
    current.questionId,
    current.body,
    current.idempotencyKey,
  );
  if (result.ok) return { kind: "accepted", isLastQuestion: result.isLastQuestion };
  if (result.code === "ANSWER_ALREADY_SUBMITTED") return { kind: "alreadySubmitted" };
  const next = result.code === "FILE_NOT_FOUND" ? { ...current, uploaded: false } : current;
  return { kind: "failed", next, failure: result };
}
