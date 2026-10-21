"use server";

import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { api, idempotencyHeaders } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import {
  getProblemDetail,
  RETRY_LATER,
  toFormActionResult,
  type FormActionResult,
} from "@/lib/api/problem-detail";
import { devicesPath, interviewPath, ROUTES } from "@/lib/routes";
import type {
  AnswerAudioContentType,
  AnswerAudioUploadUrlRequest,
  SessionCreateRequest,
  SessionResponse,
  SttTokenResponse,
  TtsTokenResponse,
  UploadUrlResponse,
} from "@/types/api";

import {
  idempotencyKeySchema,
  idSchema,
  sessionCreateSchema,
  type SessionCreateValues,
} from "./schemas";
import { toSpeechActionFailure, type SpeechActionFailure } from "./speech-failure";

// 기준: Swagger 5.1 면접 만들기(POST /interview-sessions + Idempotency-Key → 201 SessionResponse
// · 404 APPLICATION_NOT_FOUND · 409 IDEMPOTENCY_KEY_REUSED) · 기획 메모 S05-1(18:1013: [다음]을 누를 때 면접 플랜 생성 시작,
// 화상 → S05 장치 점검 · 채팅 → S05 건너뛰고 바로 면접)

export interface SessionActionResult extends FormActionResult<never> {
  /** 409 IDEMPOTENCY_KEY_REUSED: 이 키를 다른 요청에 이미 썼다. 다시 보낼 때는 새 키를 만든다. */
  keyReused?: true;
}

/**
 * 5.1 면접 만들기 → 화상이면 S05 장치 점검, 채팅이면 바로 면접(S06-B)으로 간다.
 * idempotencyKey는 같은 선택으로 다시 보낼 때 같은 값을 넘겨, 면접이 두 번 만들어지지 않게 한다.
 */
export async function createSession(
  values: SessionCreateValues,
  idempotencyKey: string,
): Promise<SessionActionResult> {
  const parsed = sessionCreateSchema.safeParse(values);
  if (!parsed.success || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    return { formError: "면접 정보를 확인해 주세요." };
  }

  const body: SessionCreateRequest = parsed.data;
  let data: SessionResponse;
  try {
    ({ data } = await api.post<SessionResponse>(endpoints.interviews.root, body, {
      headers: idempotencyHeaders(idempotencyKey),
    }));
  } catch (error) {
    // 401(TOKEN_EXPIRED · UNAUTHORIZED)이면 api가 재발급 · 로그아웃 화면으로 redirect한다. 그 신호는 Next가 처리하게 다시 던진다.
    unstable_rethrow(error);
    // 그사이 지원서가 없어졌으면(404) 이 화면에 들어올 때와 같이 처음 단계인 S03으로 보낸다.
    const code = getProblemDetail(error)?.code;
    if (code === "APPLICATION_NOT_FOUND") redirect(ROUTES.practice);
    return {
      ...toFormActionResult(error, []),
      ...(code === "IDEMPOTENCY_KEY_REUSED" && { keyReused: true }),
    };
  }
  // 고른 방식으로 갈 곳을 정한다: 채팅은 장치 점검이 필요 없어 S05를 건너뛴다(기획 메모 S05-1).
  redirect(body.mode === "VIDEO" ? devicesPath(data.id) : interviewPath(data.id));
}

// 기준: Swagger 5.3 면접 플랜 재생성(POST …/plan/retry → 202 SessionResponse(GENERATING) · 404 SESSION_NOT_FOUND
// · 409 PLAN_NOT_FAILED) · 기획 메모 S05(18:752: 생성 실패 시 재시도 안내)

/**
 * 5.3 질문 준비(면접 플랜)를 다시 시작한다. 성공하면 S05를 다시 그려(refresh) 진행률 조회(5.2)를 이어 간다.
 * 409 PLAN_NOT_FAILED는 이미 다시 준비 중이거나 끝났다는 뜻이라, 실패로 보지 않고 다시 그리기만 한다.
 */
export async function retryPlan(sessionId: number): Promise<FormActionResult<never>> {
  if (!idSchema.safeParse(sessionId).success) return { formError: RETRY_LATER };
  try {
    await api.post<SessionResponse>(endpoints.interviews.planRetry(sessionId));
  } catch (error) {
    unstable_rethrow(error);
    const code = getProblemDetail(error)?.code;
    if (code === "SESSION_NOT_FOUND") redirect(ROUTES.practice);
    if (code !== "PLAN_NOT_FAILED") return toFormActionResult(error, []);
  }
  refresh();
  return {};
}

// 기준: Swagger 5.4 면접 시작(POST …/start + Idempotency-Key → 200 SessionResponse(IN_PROGRESS)
// · 404 SESSION_NOT_FOUND · 409 PLAN_NOT_READY · INVALID_SESSION_STATE · IDEMPOTENCY_KEY_REUSED)
// · 기획 메모 S05(18:752: 생성 완료 + 장치 모두 ✓일 때만 [면접 시작])

/** 5.4 면접을 시작하고 S06 면접 화면으로 간다. 다시 보낼 때는 같은 idempotencyKey를 넘긴다. */
export async function startSession(
  sessionId: number,
  idempotencyKey: string,
): Promise<SessionActionResult> {
  if (
    !idSchema.safeParse(sessionId).success ||
    !idempotencyKeySchema.safeParse(idempotencyKey).success
  ) {
    return { formError: RETRY_LATER };
  }
  try {
    await api.post<SessionResponse>(endpoints.interviews.start(sessionId), undefined, {
      headers: idempotencyHeaders(idempotencyKey),
    });
  } catch (error) {
    unstable_rethrow(error);
    const code = getProblemDetail(error)?.code;
    if (code === "SESSION_NOT_FOUND") redirect(ROUTES.practice);
    // 질문 준비가 아직이면(PLAN_NOT_READY) 화면이 아는 준비 상태가 낡았다. 다시 그려 진행률 조회를 다시 잇는다.
    if (code === "PLAN_NOT_READY") refresh();
    return {
      ...toFormActionResult(error, []),
      ...(code === "IDEMPOTENCY_KEY_REUSED" && { keyReused: true }),
    };
  }
  redirect(interviewPath(sessionId));
}

// 기준: Swagger 5.10 실시간 음성 인식 토큰(POST …/stt-token → 200 SttTokenResponse · 404 SESSION_NOT_FOUND
// · 409 INVALID_SESSION_STATE · 503 STT_UNAVAILABLE) · API 명세 5.10(키는 연결 1회에만 사용할 수 있으므로 연결할 때마다 새로 발급받는다)
// · API 명세 1장(400 VALIDATION_FAILED · 500 INTERNAL_ERROR 공통, Nginx 502 · 504는 상태 코드로 판단)

/** 5.10 결과. 성공이면 Soniox 연결용 임시 키와 연결 시작 기한, 실패면 code · status */
export type SttTokenActionResult = ({ ok: true } & SttTokenResponse) | SpeechActionFailure;

/**
 * 5.10 Soniox 실시간 음성 인식 임시 키를 발급받는다. 음성 인식에 연결할 때마다 새로 호출한다.
 * 키는 이 반환값으로만 브라우저에 전달한다(store · localStorage · props에 저장하지 않는다).
 */
export async function issueSttToken(sessionId: number): Promise<SttTokenActionResult> {
  if (!idSchema.safeParse(sessionId).success) return toSpeechActionFailure();
  try {
    const { data } = await api.post<SttTokenResponse>(endpoints.interviews.sttToken(sessionId));
    return { ok: true, token: data.token, expiresAt: data.expiresAt };
  } catch (error) {
    // 401이면 api가 재발급 · 로그아웃 화면으로 redirect한다. 그 신호는 Next가 처리하게 재전파한다.
    unstable_rethrow(error);
    return toSpeechActionFailure(error);
  }
}

// 기준: Swagger 5.12 질문 음성 토큰(POST …/questions/{questionId}/tts-token → 200 TtsTokenResponse · 404 SESSION_NOT_FOUND
// · QUESTION_NOT_FOUND · 409 INVALID_SESSION_STATE · 503 TTS_UNAVAILABLE) · API 명세 5.12(토큰은 연결 1회에만 사용할 수 있으므로
// 연결할 때마다 새로 발급받는다, 503 · 502 · 504면 질문 글만 보여 주고 계속) · API 명세 1장(400 · 500 공통)

/** 5.12 결과. 성공이면 ElevenLabs 연결용 1회용 토큰과 면접관 음성 · 모델 id, 실패면 code · status */
export type TtsTokenActionResult = ({ ok: true } & TtsTokenResponse) | SpeechActionFailure;

/**
 * 5.12 ElevenLabs 질문 음성 1회용 토큰을 발급받는다. 질문 음성에 연결할 때마다 새로 호출한다.
 * 토큰은 이 반환값으로만 브라우저에 전달한다(store · localStorage · props에 저장하지 않는다).
 */
export async function issueTtsToken(
  sessionId: number,
  questionId: number,
): Promise<TtsTokenActionResult> {
  if (!idSchema.safeParse(sessionId).success || !idSchema.safeParse(questionId).success) {
    return toSpeechActionFailure();
  }
  try {
    const { data } = await api.post<TtsTokenResponse>(
      endpoints.interviews.ttsToken(sessionId, questionId),
    );
    return {
      ok: true,
      token: data.token,
      expiresAt: data.expiresAt,
      voiceId: data.voiceId,
      modelId: data.modelId,
    };
  } catch (error) {
    // 401이면 api가 재발급 · 로그아웃 화면으로 redirect한다. 그 신호는 Next가 처리하게 재전파한다.
    unstable_rethrow(error);
    return toSpeechActionFailure(error);
  }
}

// 기준: Swagger 5.6 답변 음성 업로드 주소(POST …/questions/{questionId}/answer-audio/upload-url + AnswerAudioUploadUrlRequest
// → 200 UploadUrlResponse · 404 SESSION_NOT_FOUND · QUESTION_NOT_FOUND · 409 INVALID_SESSION_STATE) · API 명세 5.6(objectKey는
// 5.7 audioObjectKey로 전송한다) · API 명세 1장(400 VALIDATION_FAILED · 500 INTERNAL_ERROR 공통, Nginx 502 · 504는 상태 코드로 판단)

/** 5.6 결과. 성공이면 답변 음성을 PUT할 주소 · 5.7에 전송할 objectKey · 주소 만료 일시, 실패면 code · status */
export type AnswerAudioUploadUrlActionResult =
  ({ ok: true } & UploadUrlResponse) | SpeechActionFailure;

/**
 * 5.6 화상 답변 음성을 업로드할 주소를 발급받는다. 수신한 uploadUrl로 브라우저가 S3에 직접 PUT한다(AGENTS.md 예외).
 * contentType은 답변 녹음(AnswerCapture.start)이 결정한 녹음 형식을 그대로 전달한다.
 */
export async function createAnswerAudioUploadUrl(
  sessionId: number,
  questionId: number,
  contentType: AnswerAudioContentType,
): Promise<AnswerAudioUploadUrlActionResult> {
  if (!idSchema.safeParse(sessionId).success || !idSchema.safeParse(questionId).success) {
    return toSpeechActionFailure();
  }
  const body: AnswerAudioUploadUrlRequest = { contentType };
  try {
    const { data } = await api.post<UploadUrlResponse>(
      endpoints.interviews.answerAudioUploadUrl(sessionId, questionId),
      body,
    );
    return {
      ok: true,
      uploadUrl: data.uploadUrl,
      objectKey: data.objectKey,
      expiresAt: data.expiresAt,
    };
  } catch (error) {
    // 401이면 api가 재발급 · 로그아웃 화면으로 redirect한다. 그 신호는 Next가 처리하게 재전파한다.
    unstable_rethrow(error);
    return toSpeechActionFailure(error);
  }
}
