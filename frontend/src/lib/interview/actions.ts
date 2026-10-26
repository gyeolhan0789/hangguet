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
  AnswerRequest,
  AnswerResponse,
  RoomResponse,
  SessionCreateRequest,
  SessionResponse,
} from "@/types/api";

import {
  answerTextSchema,
  idempotencyKeySchema,
  idSchema,
  sessionCreateSchema,
  type AnswerTextValues,
  type SessionCreateValues,
} from "./schemas";
import { toSpeechActionFailure, type SpeechActionFailure } from "./speech-failure";

// 기준: 웹 Swagger 5.14 POST /interview-sessions/{sessionId}/room-token · RoomResponse.
// 면접 시작 후 화면 진입·새로고침·재입장 시 사용한다. 토큰은 브라우저 메모리에서만 사용한다.
export type RoomTokenActionResult = ({ ok: true } & RoomResponse) | SpeechActionFailure;

export async function issueRoomToken(sessionId: number): Promise<RoomTokenActionResult> {
  if (!idSchema.safeParse(sessionId).success) return toSpeechActionFailure();
  try {
    const { data } = await api.post<RoomResponse>(endpoints.interviews.roomToken(sessionId));
    return { ok: true, url: data.url, token: data.token, expiresAt: data.expiresAt };
  } catch (error) {
    unstable_rethrow(error);
    return toSpeechActionFailure(error);
  }
}

// 기준: Swagger 5.1 면접 만들기(POST /interview-sessions + Idempotency-Key → 201 SessionResponse
// · 404 APPLICATION_NOT_FOUND · 409 IDEMPOTENCY_KEY_REUSED) · 기획 메모 S05-1(18:1013: [다음]을 누를 때 면접 플랜 생성 시작,
// 화상 → S05 장치 점검 · 채팅 → S05 건너뛰고 바로 면접)

export interface SessionActionResult extends FormActionResult<never> {
  /** 5.8 면접 끝내기 응답의 레벨업(웹 Swagger leveledUp: 5.8 응답에만 값이 있어 화면이 기억한다) */
  leveledUp?: boolean | null;
  /**
   * 서버가 이 멱등 키의 요청에 실패로 답했다. 웹 Swagger Idempotency-Key는 "같은 키·같은 본문이면 처음 결과를 그대로 반환"이라,
   * 다시 보낼 때는 새 키를 만든다. 응답을 받지 못한 실패(연결 오류 등)는 같은 키로 다시 보낸다.
   */
  keySpent?: true;
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
      ...(getProblemDetail(error) && { keySpent: true }),
    };
  }
  // 고른 방식으로 갈 곳을 정한다: 채팅은 장치 점검이 필요 없어 S05를 건너뛴다(기획 메모 S05-1).
  redirect(body.mode === "VIDEO" ? devicesPath(data.id) : interviewPath(data.id));
}

// 기준: Swagger 5.3 면접 플랜 재생성(POST …/plan/retry → 202 SessionResponse(GENERATING) · 404 SESSION_NOT_FOUND
// · 409 PLAN_NOT_FAILED) · 기획 메모 S05(18:752: 생성 실패 시 재시도 안내)

/**
 * 5.3 질문 준비(면접 플랜)를 다시 시작한다. 성공하면 화면을 다시 그려(refresh) 진행률 조회(5.2)를 이어 간다.
 * 409 PLAN_NOT_FAILED는 이미 다시 준비 중이거나 끝났다는 뜻이라, 다시 그리면서 서버 문구(detail)도 돌려준다.
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
    refresh();
    return toFormActionResult(error, []);
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
      ...(getProblemDetail(error) && { keySpent: true }),
    };
  }
  redirect(interviewPath(sessionId));
}

// 기준: Swagger 5.7 답변 제출(POST …/questions/{questionId}/answer + Idempotency-Key → 202 AnswerResponse
// · 400 VALIDATION_FAILED · 404 SESSION_NOT_FOUND · QUESTION_NOT_FOUND · 409 ANSWER_ALREADY_SUBMITTED · INVALID_SESSION_STATE
// · IDEMPOTENCY_KEY_REUSED) · 웹 Swagger 5.5(다음 질문은 5.5로 받는다)

export interface TextAnswerActionResult extends SessionActionResult {
  fieldErrors?: { content?: string };
  /** 제출에 성공했고 마지막 질문이었으면 true → 화면이 면접 끝내기(5.8)를 부른다 */
  isLastQuestion?: boolean;
  /** 이미 낸 답변이었으면(409 ANSWER_ALREADY_SUBMITTED) true → 화면이 에이전트에 [답변 완료]를 다시 보낸다(API 명세 5.7) */
  alreadySubmitted?: boolean;
}

/**
 * 5.7 채팅 답변을 낸다. 성공하면 S06-B를 다시 그려(refresh) 5.5로 다음 질문을 기다린다.
 * 다시 보낼 때는 같은 idempotencyKey를 넘긴다.
 */
export async function submitTextAnswer(
  sessionId: number,
  questionId: number,
  values: AnswerTextValues,
  idempotencyKey: string,
): Promise<TextAnswerActionResult> {
  const parsed = answerTextSchema.safeParse(values);
  if (!parsed.success) {
    return { fieldErrors: { content: parsed.error.issues[0].message } };
  }
  if (
    !idSchema.safeParse(sessionId).success ||
    !idSchema.safeParse(questionId).success ||
    !idempotencyKeySchema.safeParse(idempotencyKey).success
  ) {
    return { formError: RETRY_LATER };
  }

  const body: AnswerRequest = { inputType: "TEXT", content: parsed.data.content };
  let data: AnswerResponse;
  try {
    ({ data } = await api.post<AnswerResponse>(
      endpoints.interviews.answer(sessionId, questionId),
      body,
      {
        headers: idempotencyHeaders(idempotencyKey),
      },
    ));
  } catch (error) {
    unstable_rethrow(error);
    const code = getProblemDetail(error)?.code;
    if (code === "SESSION_NOT_FOUND") redirect(ROUTES.practice);
    // 이미 낸 답변 · 면접이 이미 끝남 · 지나간 질문이면 화면이 아는 상태가 낡았다. 다시 그려 5.2로 지금 상태를 받는다.
    if (
      code === "ANSWER_ALREADY_SUBMITTED" ||
      code === "INVALID_SESSION_STATE" ||
      code === "QUESTION_NOT_FOUND"
    ) {
      refresh();
    }
    return {
      ...toFormActionResult(error, ["content"]),
      ...(getProblemDetail(error) && { keySpent: true }),
      ...(code === "ANSWER_ALREADY_SUBMITTED" && { alreadySubmitted: true }),
    };
  }
  refresh();
  return { isLastQuestion: data.isLastQuestion };
}

// 기준: Swagger 5.8 면접 끝내기(POST …/end + Idempotency-Key → 202 SessionResponse(ANALYZING) · 200 SessionResponse(ABORTED)
// · 404 SESSION_NOT_FOUND · 409 INVALID_SESSION_STATE · IDEMPOTENCY_KEY_REUSED)
// · 웹 Swagger 5.8(답변 0개면 200 ABORTED '답변 0개 → 홈') · 기획 메모 S06-E(18:3508: 끝내기 → S06-1)

/**
 * 5.8 면접을 끝낸다. 답변이 있으면(ANALYZING) 화면을 다시 그려 S06-1 결과 분석 중으로 바꾸고,
 * 답변 없이 끝났으면(ABORTED) 홈으로 간다. 다시 보낼 때는 같은 idempotencyKey를 넘긴다.
 */
export async function endSession(
  sessionId: number,
  idempotencyKey: string,
): Promise<SessionActionResult> {
  if (
    !idSchema.safeParse(sessionId).success ||
    !idempotencyKeySchema.safeParse(idempotencyKey).success
  ) {
    return { formError: RETRY_LATER };
  }
  let data: SessionResponse;
  try {
    ({ data } = await api.post<SessionResponse>(endpoints.interviews.end(sessionId), undefined, {
      headers: idempotencyHeaders(idempotencyKey),
    }));
  } catch (error) {
    unstable_rethrow(error);
    const code = getProblemDetail(error)?.code;
    if (code === "SESSION_NOT_FOUND") redirect(ROUTES.practice);
    // 이미 끝난 면접이면 화면이 아는 상태가 낡았다. 다시 그려 5.2로 지금 상태를 받는다.
    if (code === "INVALID_SESSION_STATE") refresh();
    return {
      ...toFormActionResult(error, []),
      ...(getProblemDetail(error) && { keySpent: true }),
    };
  }
  if (data.status === "ABORTED") redirect(ROUTES.home);
  refresh();
  return { leveledUp: data.leveledUp };
}
