import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail } from "@/lib/api/problem-detail";
import { parsePositiveId } from "@/lib/parse-id";
import type {
  ApplicationListQuery,
  ApplicationListResponse,
  ApplicationResponse,
  ApplicationSessionListQuery,
  ApplicationSessionListResponse,
} from "@/types/api";

// 기준: Swagger 4.2 지원서 조회(GET /applications/{applicationId} → 200 ApplicationResponse · 404 APPLICATION_NOT_FOUND)
// · 4.3 지원서 목록(GET /applications → 200 ApplicationListResponse, 최근 작성순, page 0부터 · size 1~20 기본 10, 문항 없음)
// · 4.6 지원서의 연습 면접 목록(GET /applications/{applicationId}/interview-sessions → 200 ApplicationSessionListResponse,
//   시작 시각 내림차순, page 0부터 · size 1~20 기본 10 · 404 APPLICATION_NOT_FOUND)

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

/** 4.3 지원서 목록. 서버 컴포넌트에서만 부른다. */
export async function getApplications(
  page: number,
  size: number,
): Promise<ApplicationListResponse> {
  const params: ApplicationListQuery = { page, size };
  const { data } = await api.get<ApplicationListResponse>(endpoints.applications.root, { params });
  return data;
}

/** 4.6 지원서의 연습 면접 목록. 지원서가 없으면(404) null. 서버 컴포넌트에서만 부른다. */
export async function getApplicationSessions(
  applicationId: number,
  page: number,
  size: number,
): Promise<ApplicationSessionListResponse | null> {
  const params: ApplicationSessionListQuery = { page, size };
  try {
    const { data } = await api.get<ApplicationSessionListResponse>(
      endpoints.applications.sessions(applicationId),
      { params },
    );
    return data;
  } catch (error) {
    if (getProblemDetail(error)?.code === "APPLICATION_NOT_FOUND") return null;
    throw error;
  }
}

/** 주소의 applicationId(양의 정수)를 읽는다. 없거나 형식이 틀리면 null */
export const parseApplicationId = parsePositiveId;
