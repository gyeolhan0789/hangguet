import { describe, expect, it } from "vitest";

import { formatElapsed, TOTAL_QUESTIONS } from "./questions";

// 기준: API 명세 5.2(전체 질문 수 5 고정) · Figma S06 Progress Pill('08:42')

describe("formatElapsed", () => {
  it.each([
    [0, "00:00"],
    [59, "00:59"],
    [522, "08:42"],
    [3600, "60:00"],
    [3665, "61:05"],
    [-3, "00:00"],
    [12.9, "00:12"],
  ])("%d초 → %s", (seconds, text) => {
    expect(formatElapsed(seconds)).toBe(text);
  });
});

it("질문 수는 5개다", () => {
  expect(TOTAL_QUESTIONS).toBe(5);
});
