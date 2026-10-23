import type { SessionCalendarResponse, SessionListResponse } from "@/types/api";

// 웹 Swagger 5.13 200 예시('완료·분석 중' 2026-10-21 · '기록 없는 날짜')와 웹 목 서버의 2026-10-20 실제 응답
// (실패 · 총평 없는 완료, Swagger 설명 '목 예시는 2026-10-20(실패·총평 없음)'), 5.15 2026-10 실제 응답.
// 연습 기록 단위 · 컴포넌트 테스트와 E2E mock이 함께 쓴다.

/** 5.13 연습 면접 목록 200 */
export const SESSION_LIST: Record<"DAILY" | "DAY_20" | "EMPTY", SessionListResponse> = {
  // Swagger 예시 '완료·분석 중'
  DAILY: {
    content: [
      {
        id: 55,
        companyName: "○○전자",
        jobTitle: "백엔드 개발자",
        persona: "DEVIL",
        mode: "VIDEO",
        status: "COMPLETED",
        startedAt: "2026-10-21T23:50:00+09:00",
        endedAt: "2026-10-22T00:10:00+09:00",
        answeredCount: 5,
        summary: "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
        criterionGrades: [
          { criterion: "JOB_FIT", grade: "GOOD" },
          { criterion: "COVER_LETTER", grade: "WEAK" },
          { criterion: "LOGIC", grade: "GOOD" },
          { criterion: "DELIVERY", grade: "NORMAL" },
        ],
      },
      {
        id: 54,
        companyName: "△△소프트",
        jobTitle: "서버 개발자",
        persona: "COFFEE_CHAT",
        mode: "CHAT",
        status: "ANALYZING",
        startedAt: "2026-10-21T19:30:00+09:00",
        endedAt: "2026-10-21T19:42:00+09:00",
        answeredCount: 3,
        summary: null,
        criterionGrades: [],
      },
    ],
    page: { size: 5, number: 0, totalElements: 2, totalPages: 1 },
    summary: { totalInterviewCount: 4, practiceMinutes: 32 },
  },
  // 웹 목 서버 practiceDate=2026-10-20 실제 응답(실패 · 총평 없는 완료)
  DAY_20: {
    content: [
      {
        id: 53,
        companyName: "△△소프트",
        jobTitle: "서버 개발자",
        persona: "COFFEE_CHAT",
        mode: "VIDEO",
        status: "FAILED",
        startedAt: "2026-10-20T21:00:00+09:00",
        endedAt: "2026-10-20T21:22:00+09:00",
        answeredCount: 5,
        summary: null,
        criterionGrades: [],
      },
      {
        id: 52,
        companyName: "○○전자",
        jobTitle: "백엔드 개발자",
        persona: "DEVIL",
        mode: "CHAT",
        status: "COMPLETED",
        startedAt: "2026-10-20T20:00:00+09:00",
        endedAt: "2026-10-20T20:10:00+09:00",
        answeredCount: 2,
        summary: null,
        criterionGrades: [
          { criterion: "JOB_FIT", grade: "NORMAL" },
          { criterion: "COVER_LETTER", grade: "NORMAL" },
          { criterion: "LOGIC", grade: "GOOD" },
          { criterion: "DELIVERY", grade: "NORMAL" },
        ],
      },
    ],
    page: { size: 5, number: 0, totalElements: 2, totalPages: 1 },
    summary: { totalInterviewCount: 4, practiceMinutes: 32 },
  },
  // Swagger 예시 '기록 없는 날짜'
  EMPTY: {
    content: [],
    page: { size: 5, number: 0, totalElements: 0, totalPages: 0 },
    summary: { totalInterviewCount: 4, practiceMinutes: 0 },
  },
};

/** 5.15 월별 연습 면접 횟수 200 — 웹 목 서버 month=2026-10 실제 응답(10월 모든 날짜, 20 · 21일만 2회) */
export const SESSION_CALENDAR: SessionCalendarResponse = {
  month: "2026-10",
  content: Array.from({ length: 31 }, (_, i) => {
    const practiceDate = `2026-10-${String(i + 1).padStart(2, "0")}`;
    return {
      practiceDate,
      interviewCount: practiceDate === "2026-10-20" || practiceDate === "2026-10-21" ? 2 : 0,
    };
  }),
};
