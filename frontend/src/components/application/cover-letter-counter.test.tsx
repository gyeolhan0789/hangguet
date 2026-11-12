// 기준: Figma S03 Label Row 자기소개서 · 모션 메모 지원서 쓰기(바뀔 때 카운트업 · 튐, 최대 200자 전 주황 · 최대 빨강)
// · 사용자 결정(2026-10-29: 답변은 문항마다 20,000자)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoverLetterCounter, counterTone } from "./cover-letter-counter";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

const MAX = 20000;

describe("counterTone · 글자 수 상태", () => {
  describe("경계값", () => {
    it.each([
      { length: 19800, tone: "normal" },
      { length: 19801, tone: "near" },
      { length: 19999, tone: "near" },
      { length: 20000, tone: "max" },
    ] as const)("글자 수가 '$length'면 '$tone'이다", ({ length, tone }) => {
      expect(counterTone(length, MAX)).toBe(tone);
    });
  });
});

describe("CoverLetterCounter · 답변 글자 수", () => {
  describe("화면 표시", () => {
    it("최대 글자 수에 닿으면 상태를 글로도 읽어 준다", () => {
      render(<CoverLetterCounter id="count" length={MAX} max={MAX} />);

      expect(screen.getByText("글자 수 20,000 / 20,000, 최대 글자 수예요")).toBeDefined();
    });
  });
});
