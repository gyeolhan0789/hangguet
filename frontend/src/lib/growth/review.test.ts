import { describe, expect, it } from "vitest";

import { tierOf } from "@/lib/streak";
import { GROWTH_REVIEW } from "@/test/growth-review-examples";
import type { CriterionReview, GrowthReviewResponse } from "@/types/api";

import {
  improvedRows,
  monthDay,
  reviewWeek,
  surveyRound,
  tierChipText,
  tierChipTone,
} from "./review";

// 기준: S08 '오늘 나아진 점'은 delta > 0인 기준, 자소서 검증은 delta 없이 comment만, S08-C는 grade로 기준점,
// 설문 유도는 3 · 7 · 21일째 · GrowthReviewResponse(practiceDates: 그날 포함 최근 7일 중 연습한 날) · Swagger 7.1 예시
// · 사용자 결정(2026-10-22: 자소서 검증은 '좋아요'일 때만 [통과], 칩 문구 '{단계 이름} · N일째', 지난 날짜는 '오늘' 대신 그날 요일)

// Swagger 7.1 'S08 오늘의 성장 리뷰' 예시의 기준 4개
const CRITERIA: CriterionReview[] = GROWTH_REVIEW.S08.criteria;

const review = (overrides: Partial<GrowthReviewResponse>): GrowthReviewResponse => ({
  ...GROWTH_REVIEW.S08,
  ...overrides,
});

describe("improvedRows (오늘 나아진 점)", () => {
  it("점수가 오른 기준은 +N으로, '좋아요'인 자소서 검증은 [통과]로 응답 순서대로 넣고, 오르지 않은 기준은 뺀다", () => {
    expect(
      improvedRows(CRITERIA).map((row) => [
        row.review.criterion,
        row.kind === "delta" ? row.delta : "pass",
      ]),
    ).toEqual([
      ["DELIVERY", 8],
      ["LOGIC", 4],
      ["COVER_LETTER", "pass"],
    ]);
  });

  it("자소서 검증이 '보통' · '아쉬워요'면 넣지 않는다(점수가 올라도)", () => {
    for (const grade of ["NORMAL", "WEAK"] as const) {
      const criteria = CRITERIA.map((item) =>
        item.criterion === "COVER_LETTER" ? { ...item, grade, delta: 5 } : item,
      );
      expect(improvedRows(criteria).map((row) => row.review.criterion)).not.toContain(
        "COVER_LETTER",
      );
    }
  });

  it("변화가 없는(null · 0) 기준은 넣지 않는다", () => {
    const criteria = CRITERIA.map((item) => ({
      ...item,
      delta: item.criterion === "LOGIC" ? null : 0,
    }));
    expect(improvedRows(criteria).map((row) => row.review.criterion)).toEqual(["COVER_LETTER"]);
  });
});

describe("reviewWeek (7일 동그라미)", () => {
  it("S08: 그날까지 최근 7일을 요일로 보여 주고, 연습한 날만 체크, 마지막 칸은 오늘이면 '오늘'", () => {
    // 2026-10-13은 화요일
    const days = reviewWeek(
      review({ practiceDates: ["2026-10-11", "2026-10-12", "2026-10-13"] }),
      true,
    );
    expect(days.map((day) => day.label)).toEqual(["수", "목", "금", "토", "일", "월", "오늘"]);
    expect(days.map((day) => day.done)).toEqual([false, false, false, false, true, true, true]);
    expect(days.map((day) => day.current)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("지난 날짜면 마지막 칸도 요일이다", () => {
    expect(reviewWeek(review({}), false).at(-1)?.label).toBe("화");
  });

  it("S08-C(첫 연습일): 그날부터 앞으로 7일 '오늘 · +1 … +6'이고 그날만 체크", () => {
    const days = reviewWeek(
      review({ isFirst: true, practiceDate: "2026-10-15", practiceDates: ["2026-10-15"] }),
      true,
    );
    expect(days.map((day) => day.label)).toEqual(["오늘", "+1", "+2", "+3", "+4", "+5", "+6"]);
    expect(days.map((day) => day.date)).toEqual([
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
    ]);
    expect(days.map((day) => day.done)).toEqual([true, false, false, false, false, false, false]);
  });

  it("S08-C 지난 날짜면 첫 칸도 '오늘' 대신 그날 요일이다", () => {
    // 2026-10-15는 목요일
    const days = reviewWeek(GROWTH_REVIEW.FIRST, false);
    expect(days.map((day) => day.label)).toEqual(["목", "+1", "+2", "+3", "+4", "+5", "+6"]);
  });

  it("월말을 넘겨도 날짜를 바르게 센다", () => {
    const days = reviewWeek(review({ practiceDate: "2026-11-02", practiceDates: [] }), false);
    expect(days[0].date).toBe("2026-10-27");
  });
});

describe("문구", () => {
  it("YYYY-MM-DD를 'M월 D일'로 쓴다", () => {
    expect(monthDay("2026-10-13")).toBe("10월 13일");
    expect(monthDay("2026-01-05")).toBe("1월 5일");
  });

  // 스트릭 뱃지 단계: 불씨 1-2 · 활활 불꽃 3-5 · 황금 불꽃 6-7 · 푸른 불꽃 8-13 · 전설의 불꽃 14+ (lib/streak)
  it.each([
    [1, "불씨 · 1일째"],
    [2, "불씨 · 2일째"],
    [3, "활활 불꽃 · 3일째"],
    [5, "활활 불꽃 · 5일째"],
    [6, "황금 불꽃 · 6일째"],
    [7, "황금 불꽃 · 7일째"],
    [8, "푸른 불꽃 · 8일째"],
    [13, "푸른 불꽃 · 13일째"],
    [14, "전설의 불꽃 · 14일째"],
    [21, "전설의 불꽃 · 21일째"],
  ])("불꽃 칩: %i일째는 '%s'", (days, text) => {
    expect(tierChipText(days)).toBe(text);
  });

  it.each([
    [1, "bg-red-soft"],
    [2, "bg-red-soft"],
    [3, "bg-brand-soft"],
    [5, "bg-brand-soft"],
    [6, "bg-gold-soft"],
    [7, "bg-gold-soft"],
  ])("불꽃 칩 색: Figma에 있는 단계(%i일째)는 토큰(%s)을 쓴다", (days, token) => {
    expect(tierChipTone(tierOf(days)).className).toContain(token);
  });

  it.each([
    [8, "#2F6BFF"],
    [13, "#2F6BFF"],
    [14, "#FFB8E8"],
  ])("불꽃 칩 색: 그 위 단계(%i일째)는 단계 색(%s)을 쓴다", (days, color) => {
    expect(tierChipTone(tierOf(days)).style).toEqual({
      backgroundColor: `${color}1f`,
      color,
    });
  });
});

describe("surveyRound (S08-B 설문 회차)", () => {
  it.each([3, 7, 21])("%i일째는 설문 회차다", (streak) => {
    expect(surveyRound(streak)).toBe(streak);
  });

  it.each([1, 2, 4, 6, 8, 14, 20, 22])("%i일째는 설문을 띄우지 않는다", (streak) => {
    expect(surveyRound(streak)).toBeNull();
  });
});
