import { describe, expect, it } from "vitest";

import { COUNTER_WARN_GAP, counterTone } from "./cover-letter-counter";

// 기준: cover-letter-counter.tsx 출처 주석(모션 메모 지원서 쓰기 "최대 200자 전을 넘으면 주황 → 최대 도달 시 빨강",
// 사용자 결정 2026-10-29: 답변은 문항마다 20,000자, 최대치가 바뀌어도 최대 200자 전부터 알림)
describe("counterTone (최대치와 상관없는 경계: 최대 − 200자 초과면 near, 최대면 max)", () => {
  const max = 1000;
  it.each([
    { length: 0, tone: "normal" },
    { length: max - COUNTER_WARN_GAP, tone: "normal" },
    { length: max - COUNTER_WARN_GAP + 1, tone: "near" },
    { length: max - 1, tone: "near" },
    { length: max, tone: "max" },
  ] as const)("최대 1,000자에서 $length자 → $tone", ({ length, tone }) => {
    expect(COUNTER_WARN_GAP).toBe(200);
    expect(counterTone(length, max)).toBe(tone);
  });
});

describe("counterTone (지원서 쓰기 답변, 문항마다 20,000자)", () => {
  it.each([
    { length: 0, tone: "normal" },
    { length: 19800, tone: "normal" },
    { length: 19801, tone: "near" },
    { length: 19999, tone: "near" },
    { length: 20000, tone: "max" },
  ] as const)("$length자 → $tone", ({ length, tone }) => {
    expect(counterTone(length, 20000)).toBe(tone);
  });
});
