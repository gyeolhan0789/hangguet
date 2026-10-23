import type { HomeResponse } from "@/types/api";

// 웹 Swagger 3.1 예시와 같은 값 (테스트용). 오늘은 2026-10-15로 본다.
export const FIXTURE_TODAY = "2026-10-15";

export const HOME_NOT_DONE: HomeResponse = {
  homeState: "NOT_DONE_TODAY",
  currentStreak: 7,
  bestStreak: 7,
  practiceDates: [
    "2026-10-09",
    "2026-10-10",
    "2026-10-11",
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
  ],
  todayInterviewCount: 0,
  todayPracticeMinutes: 0,
  todayImprovements: [],
  nextActions: ["꼬리 질문엔 근거부터 짧게"],
  nextActionsDate: "2026-10-14",
  recentReviews: [
    { practiceDate: "2026-10-14", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
    { practiceDate: "2026-10-13", companyName: "△△소프트", criterion: "LOGIC", delta: 4 },
  ],
};

export const HOME_DONE: HomeResponse = {
  ...HOME_NOT_DONE,
  homeState: "DONE_TODAY",
  currentStreak: 8,
  bestStreak: 8,
  practiceDates: [...HOME_NOT_DONE.practiceDates, "2026-10-15"],
  todayInterviewCount: 1,
  todayPracticeMinutes: 18,
  todayImprovements: [
    { criterion: "DELIVERY", delta: 8 },
    { criterion: "LOGIC", delta: 4 },
  ],
  nextActions: ["꼬리 질문엔 근거부터 짧게", "직무 적합성 질문 1개 더 연습하기"],
  nextActionsDate: "2026-10-15",
  recentReviews: [
    { practiceDate: "2026-10-15", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
    { practiceDate: "2026-10-14", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
  ],
};

export const HOME_BROKEN: HomeResponse = {
  ...HOME_NOT_DONE,
  homeState: "BROKEN",
  currentStreak: 0,
  bestStreak: 7,
  practiceDates: ["2026-10-10", "2026-10-11", "2026-10-12"],
  nextActionsDate: "2026-10-12",
  recentReviews: [
    { practiceDate: "2026-10-12", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
    { practiceDate: "2026-10-11", companyName: "△△소프트", criterion: "LOGIC", delta: 4 },
  ],
};

export const HOME_FIRST: HomeResponse = {
  homeState: "FIRST_VISIT",
  currentStreak: 0,
  bestStreak: 0,
  practiceDates: [],
  todayInterviewCount: 0,
  todayPracticeMinutes: 0,
  todayImprovements: [],
  nextActions: [],
  nextActionsDate: null,
  recentReviews: [],
};
