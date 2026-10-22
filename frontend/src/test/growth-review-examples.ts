import type { GrowthReviewResponse } from "@/types/api";

// Swagger 7.1 200 예시('S08 오늘의 성장 리뷰' 8일째 · 'S08-C 첫 면접' 1일째). S08 단위 · 컴포넌트 테스트와 E2E mock이 함께 쓴다.

/** 7.1 날짜별 성장 리뷰 200 — Swagger 예시 */
export const GROWTH_REVIEW: Record<"S08" | "FIRST", GrowthReviewResponse> = {
  S08: {
    practiceDate: "2026-10-13",
    isFirst: false,
    comparedDate: "2026-10-12",
    streakOnDate: 8,
    practiceDates: [
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
    ],
    interviewCount: 1,
    practiceMinutes: 18,
    criteria: [
      {
        criterion: "DELIVERY",
        score: 70,
        grade: "NORMAL",
        delta: 8,
        comment: "말 끊김이 줄었어요",
      },
      { criterion: "LOGIC", score: 80, grade: "GOOD", delta: 4, comment: "결론부터 말했어요" },
      { criterion: "COVER_LETTER", score: 76, grade: "GOOD", delta: 0, comment: "막힘 없이 통과" },
      {
        criterion: "JOB_FIT",
        score: 62,
        grade: "NORMAL",
        delta: -3,
        comment: "직무 적합성 질문 1개 더 연습하기",
      },
    ],
    nextActions: ["직무 적합성 질문 1개 더 연습하기"],
  },
  FIRST: {
    practiceDate: "2026-10-15",
    isFirst: true,
    comparedDate: null,
    streakOnDate: 1,
    practiceDates: ["2026-10-15"],
    interviewCount: 1,
    practiceMinutes: 18,
    criteria: [
      {
        criterion: "JOB_FIT",
        score: 82,
        grade: "GOOD",
        delta: null,
        comment: "직무 경험을 수치로 설명했어요",
      },
      {
        criterion: "COVER_LETTER",
        score: 58,
        grade: "WEAK",
        delta: null,
        comment: "꼬리 질문엔 근거부터 짧게",
      },
      { criterion: "LOGIC", score: 80, grade: "GOOD", delta: null, comment: "결론부터 말했어요" },
      {
        criterion: "DELIVERY",
        score: 70,
        grade: "NORMAL",
        delta: null,
        comment: "말 끊김이 줄었어요",
      },
    ],
    nextActions: ["꼬리 질문엔 근거부터 짧게"],
  },
};
