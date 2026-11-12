// 기준: Figma S07 Summary(18:2640) · ResultResponse(persona · companyName · jobTitle · summary · startedAt · endedAt)
// · 사용자 결정(2026-10-22: 썸네일은 이미지) · ResultResponse.summary(null이면 총평 줄을 그리지 않는다)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RESULT } from "@/test/result-examples";

import { ResultSummary } from "./result-summary";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

describe("ResultSummary · 결과 요약", () => {
  describe("화면 표시", () => {
    it("면접관 · 회사 직무 · 면접 시간(분)을 한 줄로 보여 준다", () => {
      render(<ResultSummary result={RESULT} />);

      expect(screen.getByText("악마 면접관 · ○○전자 백엔드 개발자 · 18분")).toBeDefined();
    });

    it("총평이 없으면(null) 제목을 그리지 않는다", () => {
      render(<ResultSummary result={{ ...RESULT, summary: null }} />);

      expect(screen.queryByRole("heading")).toBeNull();
    });
  });
});
