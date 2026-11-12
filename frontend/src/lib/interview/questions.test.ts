// @vitest-environment node
// 기준: Figma S06 경과 시간 '08:42' · 웹 Swagger SessionResponse.elapsedSeconds
import { describe, expect, it } from "vitest";

import { formatElapsed } from "./questions";

describe("formatElapsed · 경과 시간 표시", () => {
  describe("정상 처리", () => {
    it("522초를 '08:42'로 쓴다", () => {
      expect(formatElapsed(522)).toBe("08:42");
    });
  });

  describe("입력 검증", () => {
    it("음수면 '00:00'으로 쓴다", () => {
      expect(formatElapsed(-5)).toBe("00:00");
    });

    it("소수는 버리고 쓴다", () => {
      // 다시보기 영상 시각처럼 소수 초가 들어온다
      expect(formatElapsed(59.9)).toBe("00:59");
    });
  });

  describe("경계값", () => {
    it.each([
      { seconds: 0, text: "00:00" },
      { seconds: 59, text: "00:59" },
      { seconds: 60, text: "01:00" },
      { seconds: 3600, text: "60:00" },
      { seconds: 3665, text: "61:05" },
    ])("'$seconds'초를 '$text'로 쓴다", ({ seconds, text }) => {
      expect(formatElapsed(seconds)).toBe(text);
    });
  });
});
