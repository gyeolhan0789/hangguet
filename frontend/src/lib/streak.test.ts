// @vitest-environment node
// 기준: Figma "스트릭 뱃지 색상 — 확정"(0 끊김 · 1~2 불씨 · 3~5 활활 · 6~7 황금 · 8~13 푸른 · 14~ 전설)
import { describe, expect, it } from "vitest";

import { nextTierOf, previousTierOf, tierOf } from "./streak";

describe("tierOf · 스트릭 단계", () => {
  describe("경계값", () => {
    it.each([
      { days: 0, name: "스트릭 끊김" },
      { days: 1, name: "불씨" },
      { days: 2, name: "불씨" },
      { days: 3, name: "활활 불꽃" },
      { days: 5, name: "활활 불꽃" },
      { days: 6, name: "황금 불꽃" },
      { days: 7, name: "황금 불꽃" },
      { days: 8, name: "푸른 불꽃" },
      { days: 13, name: "푸른 불꽃" },
      { days: 14, name: "전설의 불꽃" },
    ])("'$days'일이면 '$name' 단계를 돌려준다", ({ days, name }) => {
      expect(tierOf(days).name).toBe(name);
    });
  });
});

describe("nextTierOf · 다음 단계", () => {
  describe("정상 처리", () => {
    it("다음 단계를 돌려준다", () => {
      expect(nextTierOf(tierOf(7))).toBe(tierOf(8));
    });
  });

  describe("경계값", () => {
    it("마지막 단계면 null을 돌려준다", () => {
      expect(nextTierOf(tierOf(14))).toBeNull();
    });
  });
});

describe("previousTierOf · 이전 단계", () => {
  describe("정상 처리", () => {
    it("이전 단계를 돌려준다", () => {
      expect(previousTierOf(tierOf(8))).toBe(tierOf(7));
    });
  });
});
