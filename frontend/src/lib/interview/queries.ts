import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail } from "@/lib/api/problem-detail";
import { parsePositiveId } from "@/lib/parse-id";
import type {
  CurrentQuestion,
  PendingResponse,
  QuestionResponse,
  SessionResponse,
} from "@/types/api";

// 기준: Swagger 5.2 면접 조회(GET /interview-sessions/{sessionId} → 200 SessionResponse · 404 SESSION_NOT_FOUND)

/** 5.2 면접 조회. 없거나 내 것이 아니면(404) null. 서버 컴포넌트에서만 부른다. */
export async function getSession(sessionId: number): Promise<SessionResponse | null> {
  try {
    const { data } = await api.get<SessionResponse>(endpoints.interviews.detail(sessionId));
    return data;
  } catch (error) {
    if (getProblemDetail(error)?.code === "SESSION_NOT_FOUND") return null;
    throw error;
  }
}

// 기준: Swagger 5.5 지금 질문(GET …/questions/current → 200 QuestionResponse · 202 PendingResponse(QUESTION_GENERATING)
// · 404 SESSION_NOT_FOUND · 409 INVALID_SESSION_STATE) · API 명세 1장 상태 확인(다음 질문(S06 · S06-B): 5.5, 202 대신 200이 오면 멈춘다)

/**
 * 5.5 지금 답할 질문. 다음 질문을 만드는 중(202)이거나 면접 중이 아니면(409) · 면접이 없으면(404) null.
 * 서버 컴포넌트에서만 부른다.
 */
export async function getCurrentQuestion(sessionId: number): Promise<CurrentQuestion | null> {
  try {
    const { data, status } = await api.get<QuestionResponse | PendingResponse>(
      endpoints.interviews.currentQuestion(sessionId),
    );
    if (status === 202 || !("id" in data)) return null;
    return { id: data.id, seq: data.seq, content: data.content };
  } catch (error) {
    const code = getProblemDetail(error)?.code;
    if (code === "SESSION_NOT_FOUND" || code === "INVALID_SESSION_STATE") return null;
    throw error;
  }
}

/** 주소의 sessionId(양의 정수)를 읽는다. 없거나 형식이 틀리면 null */
export const parseSessionId = parsePositiveId;
