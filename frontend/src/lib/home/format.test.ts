// @vitest-environment node
// 기준: 웹 Swagger 3.1 Improvement(오른 점수) · RecentReviewItem(첫 연습일이면 criterion · delta null)
// · 사용자 결정(2026-10-27: 오른 기준이 없으면 BE가 전달력 0을 주고, 첫 연습일이면 배지를 숨긴다)
import { describe, expect, it } from "vitest";

import { HOME_BROKEN } from "./fixtures";
import { formatImprovement, formatReviewImprovement } from "./format";

// 예시 데이터: Swagger 3.1 예시의 최근 성장 리뷰(현 lib/home/fixtures.ts)
const REVIEW = HOME_BROKEN.recentReviews[0];

describe("formatImprovement · 오른 점수 문구", () => {
  describe("정상 처리", () => {
    it("오른 기준을 '기준 이름 +N'으로 쓴다", () => {
      expect(formatImprovement({ criterion: "LOGIC", delta: 4 })).toBe("논리성 +4");
    });
  });

  describe("경계값", () => {
    it("변화량이 0이면 '+0'으로 쓴다", () => {
      expect(formatImprovement({ criterion: "DELIVERY", delta: 0 })).toBe("전달력 +0");
    });
  });
});

describe("formatReviewImprovement · 최근 리뷰 배지 문구", () => {
  describe("정상 처리", () => {
    it("기준과 변화량이 있으면 '기준 이름 +N'을 돌려준다", () => {
      expect(formatReviewImprovement(REVIEW)).toBe("전달력 +8");
    });
  });

  describe("경계값", () => {
    it("첫 연습일이라 기준 · 변화량이 null이면 null을 돌려준다", () => {
      expect(formatReviewImprovement({ ...REVIEW, criterion: null, delta: null })).toBeNull();
    });
  });
});
