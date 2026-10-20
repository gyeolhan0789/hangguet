import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { PracticeLogsQuery, PracticeLogsResponse, StatsResponse } from "@/types/api";

// 기준: Swagger 3.2 통계(GET /users/me/stats → StatsResponse) · 3.3 연습 달력(GET /practice-logs?month=YYYY-MM
// → PracticeLogsResponse) · Figma S09 마이페이지(18:2848: 통계 타일 4개 · 스트릭 달력)

/** 3.2 통계. 서버 컴포넌트에서만 부른다. */
export async function getStats(): Promise<StatsResponse> {
  const { data } = await api.get<StatsResponse>(endpoints.home.stats);
  return data;
}

/** 3.3 연습 달력. month는 YYYY-MM. 서버 컴포넌트에서만 부른다. */
export async function getPracticeLogs(month: string): Promise<PracticeLogsResponse> {
  const params: PracticeLogsQuery = { month };
  const { data } = await api.get<PracticeLogsResponse>(endpoints.home.practiceLogs, { params });
  return data;
}
