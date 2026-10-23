import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  SessionCalendarQuery,
  SessionCalendarResponse,
  SessionListQuery,
  SessionListResponse,
} from "@/types/api";

// 기준: 웹 Swagger 5.13 연습 면접 목록(GET /interview-sessions?practiceDate&page&size → 200 SessionListResponse,
// 한국 시간 시작 날짜 · 시작 시각 · id 내림차순, size 기본 5 · 1~20) · 5.15 월별 연습 면접 횟수
// (GET /interview-sessions/calendar?month → 200 SessionCalendarResponse, 조회 월의 모든 날짜 · 기록 없으면 0)

/** 연습 기록 한 페이지의 면접 수(웹 Swagger 5.13 size 기본값 5) */
export const RECORDS_PAGE_SIZE = 5;

/** 5.13 연습 면접 목록. practiceDate(면접 시작일)의 page 페이지. 서버 컴포넌트에서만 부른다. */
export async function getSessionList(
  practiceDate: string,
  page: number,
): Promise<SessionListResponse> {
  const params: SessionListQuery = { practiceDate, page, size: RECORDS_PAGE_SIZE };
  const { data } = await api.get<SessionListResponse>(endpoints.interviews.root, { params });
  return data;
}

/** 5.15 월별 연습 면접 횟수. month는 YYYY-MM. 서버 컴포넌트에서만 부른다. */
export async function getSessionCalendar(month: string): Promise<SessionCalendarResponse> {
  const params: SessionCalendarQuery = { month };
  const { data } = await api.get<SessionCalendarResponse>(endpoints.interviews.calendar, {
    params,
  });
  return data;
}
