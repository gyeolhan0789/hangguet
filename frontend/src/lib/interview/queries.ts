import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail } from "@/lib/api/problem-detail";
import { parsePositiveId } from "@/lib/parse-id";
import type { SessionResponse } from "@/types/api";

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

/** 주소의 sessionId(양의 정수)를 읽는다. 없거나 형식이 틀리면 null */
export const parseSessionId = parsePositiveId;
