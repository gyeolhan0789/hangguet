import { describe, expect, it } from "vitest";

import { counterTone } from "./cover-letter-counter";

// 기준: Figma 모션 메모 S03 "2,800자 넘으면 주황 → 3,000자 도달 시 빨강"
describe("counterTone (자기소개서 글자 수 상태)", () => {
  it.each([
    { length: 0, tone: "normal" },
    { length: 2800, tone: "normal" },
    { length: 2801, tone: "near" },
    { length: 2999, tone: "near" },
    { length: 3000, tone: "max" },
  ] as const)("$length자 → $tone", ({ length, tone }) => {
    expect(counterTone(length, 3000)).toBe(tone);
  });
});
