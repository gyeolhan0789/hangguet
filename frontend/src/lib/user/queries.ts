import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  MyStreakFreezesResponse,
  PracticeAlarmResponse,
  PracticeLogsQuery,
  PracticeLogsResponse,
  StatsResponse,
} from "@/types/api";

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

/**
 * 8.13 내 스트릭 유지권(GET /users/me/streak-freezes → MyStreakFreezesResponse: 쓸 수 있는 개수 · 유지권별 메울 수 있는 날짜 · 만료).
 * Figma S09 스트릭 유지권 박스. 서버 컴포넌트에서만 부른다.
 */
export async function getStreakFreezes(): Promise<MyStreakFreezesResponse> {
  const { data } = await api.get<MyStreakFreezesResponse>(endpoints.streakFreezes.mine);
  return data;
}

/** 2.8 연습 알림 설정(available · enabled · time). Figma S09-1 · S09-1-B 알림 카드. 서버 컴포넌트에서만 부른다. */
export async function getPracticeAlarm(): Promise<PracticeAlarmResponse> {
  const { data } = await api.get<PracticeAlarmResponse>(endpoints.users.practiceAlarm);
  return data;
}
