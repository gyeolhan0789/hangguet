import { describe, expect, it } from "vitest";

import { blinkAt, BLINK_DURATION_MS } from "./blink";

describe("눈 깜빡임 가중치", () => {
  it("열림 · 감기는 중 · 완전히 닫힘 · 뜨는 중 · 열림을 연속적으로 표현한다", () => {
    expect(blinkAt(0)).toBe(0);
    expect(blinkAt(24)).toBeGreaterThan(0);
    expect(blinkAt(24)).toBeLessThan(1);
    expect(blinkAt(64)).toBe(1);
    expect(blinkAt(120)).toBeGreaterThan(0);
    expect(blinkAt(120)).toBeLessThan(1);
    expect(blinkAt(BLINK_DURATION_MS)).toBe(0);
  });

  it("구간 밖에서는 눈이 열리고, 어느 시점에도 가중치가 범위를 벗어나지 않는다", () => {
    expect(blinkAt(-1)).toBe(0);
    expect(blinkAt(BLINK_DURATION_MS + 1)).toBe(0);
    for (let ms = 0; ms <= BLINK_DURATION_MS; ms++) {
      expect(blinkAt(ms)).toBeGreaterThanOrEqual(0);
      expect(blinkAt(ms)).toBeLessThanOrEqual(1);
    }
  });
});
