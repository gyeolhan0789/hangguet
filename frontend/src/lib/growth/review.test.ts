// @vitest-environment node
// 기준: 웹 Swagger 7.1 · S08 '오늘 나아진 점'은 delta > 0인 기준, 자소서 검증은 grade가 GOOD이면 '통과'
// · GrowthReviewResponse.practiceDates(그날 포함 최근 7일 중 연습한 날) · Figma S08(18:2710) · S08-B(18:4578) · S08-C(18:4720)
// · 사용자 결정(2026-10-22: 자소서 검증은 '좋아요'일 때만 [통과], 지난 날짜는 '오늘' 문구를 그날 문구로)
import { describe, expect, it } from "vitest";

import { GROWTH_REVIEW } from "@/test/growth-review-examples";

import { improvedRows, monthDay, reviewWeek, surveyRound, tierChipText } from "./review";

// 예시 데이터: Swagger 7.1 200 예시 'S08 오늘의 성장 리뷰'(2026-10-13 화요일) · 'S08-C 첫 면접'(2026-10-15 목요일)
const { S08, FIRST } = GROWTH_REVIEW;
const [DELIVERY, LOGIC, COVER_LETTER] = S08.criteria;

describe("improvedRows · 나아진 점 줄", () => {
  describe("정상 처리", () => {
    it("점수가 오른 기준은 변화량 줄로, '좋아요'인 자소서 검증은 통과 줄로 응답 순서대로 만든다", () => {
      expect(improvedRows(S08.criteria)).toEqual([
        { review: DELIVERY, kind: "delta", delta: 8 },
        { review: LOGIC, kind: "delta", delta: 4 },
        { review: COVER_LETTER, kind: "pass" },
      ]);
    });

    it("자소서 검증이 '좋아요'가 아니면 넣지 않는다", () => {
      expect(improvedRows([{ ...COVER_LETTER, grade: "NORMAL", delta: 5 }])).toEqual([]);
    });
  });

  describe("경계값", () => {
    it("변화량이 0이면 넣지 않는다", () => {
      expect(improvedRows([{ ...LOGIC, delta: 0 }])).toEqual([]);
    });
  });
});

describe("reviewWeek · 성장 리뷰 7일 동그라미", () => {
  describe("정상 처리", () => {
    it("첫 연습일이 아니면 그날까지 최근 7일을 요일로 쓰고 연습한 날만 체크하며 그날만 현재 칸으로 둔다", () => {
      const review = { ...S08, practiceDates: ["2026-10-11", "2026-10-12", "2026-10-13"] };

      expect(reviewWeek(review, true)).toEqual([
        { date: "2026-10-07", label: "수", done: false, current: false },
        { date: "2026-10-08", label: "목", done: false, current: false },
        { date: "2026-10-09", label: "금", done: false, current: false },
        { date: "2026-10-10", label: "토", done: false, current: false },
        { date: "2026-10-11", label: "일", done: true, current: false },
        { date: "2026-10-12", label: "월", done: true, current: false },
        { date: "2026-10-13", label: "오늘", done: true, current: true },
      ]);
    });

    it("첫 연습일이면 그날부터 7일을 '오늘 · +1 … +6'으로 쓰고 그날만 체크한다", () => {
      expect(reviewWeek(FIRST, true)).toEqual([
        { date: "2026-10-15", label: "오늘", done: true, current: true },
        { date: "2026-10-16", label: "+1", done: false, current: false },
        { date: "2026-10-17", label: "+2", done: false, current: false },
        { date: "2026-10-18", label: "+3", done: false, current: false },
        { date: "2026-10-19", label: "+4", done: false, current: false },
        { date: "2026-10-20", label: "+5", done: false, current: false },
        { date: "2026-10-21", label: "+6", done: false, current: false },
      ]);
    });
  });

  describe("경계값", () => {
    it.each([
      { kind: "첫 연습일", review: FIRST, label: "목" },
      { kind: "아님", review: S08, label: "화" },
    ])("'$kind'의 그날이 지난 날짜면 그날 칸 글자를 요일로 쓴다", ({ review, label }) => {
      const own = reviewWeek(review, false).find((day) => day.current);

      expect(own?.label).toBe(label);
    });
  });
});

describe("monthDay · 날짜 'M월 D일'", () => {
  describe("정상 처리", () => {
    it("'YYYY-MM-DD'를 앞자리 0 없이 'M월 D일'로 바꾼다", () => {
      expect(monthDay("2026-09-05")).toBe("9월 5일");
    });
  });
});

describe("tierChipText · 불꽃 단계 칩 문구", () => {
  describe("정상 처리", () => {
    it("스트릭 일수를 '단계 이름 · N일째'로 쓴다", () => {
      expect(tierChipText(S08.streakOnDate)).toBe("푸른 불꽃 · 8일째");
    });
  });
});

describe("surveyRound · 설문 회차", () => {
  describe("정상 처리", () => {
    it("그날 스트릭이 설문 회차(7일째)면 그 회차를 돌려준다", () => {
      expect(surveyRound(7)).toBe(7);
    });
  });

  describe("경계값", () => {
    it("설문 회차가 아니면(4일째) null을 돌려준다", () => {
      expect(surveyRound(4)).toBeNull();
    });
  });
});
