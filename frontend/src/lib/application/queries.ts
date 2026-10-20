import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail } from "@/lib/api/problem-detail";
import { parsePositiveId } from "@/lib/parse-id";
import type { ApplicationResponse } from "@/types/api";

// 기준: Swagger 4.2 지원서 조회(GET /applications/{applicationId} → 200 ApplicationResponse · 404 APPLICATION_NOT_FOUND)

/** 4.2 지원서 조회. 없거나 내 것이 아니면(404) null. 서버 컴포넌트에서만 부른다. */
export async function getApplication(applicationId: number): Promise<ApplicationResponse | null> {
  try {
    const { data } = await api.get<ApplicationResponse>(
      endpoints.applications.detail(applicationId),
    );
    return data;
  } catch (error) {
    if (getProblemDetail(error)?.code === "APPLICATION_NOT_FOUND") return null;
    throw error;
  }
}

/** 주소의 applicationId(양의 정수)를 읽는다. 없거나 형식이 틀리면 null */
export const parseApplicationId = parsePositiveId;
