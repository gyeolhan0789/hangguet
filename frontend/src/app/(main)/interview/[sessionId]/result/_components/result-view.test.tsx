// 기준: Figma S07 피드백 결과(18:2620) · Swagger 6.3 ResultResponse · 웹 Swagger 7.1(practiceDate는 한국 시간 면접 시작 날짜)
// · 사용자 결정(2026-10-23: 날짜는 면접 시작 기준 — 자정을 넘어 끝나도 시작일)
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RESULT } from "@/test/result-examples";

import { ResultView } from "./result-view";

// 경계 mock: 연출(motion)은 건너뛰고, 페이지 끝 감지(IntersectionObserver, useInView)는 아무것도 알리지 않는 대역으로 둔다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 6.3 200 예시를 한국 시간 23:59에 시작해 다음 날 00:30에 끝난 면접으로 바꿈
const PAST_MIDNIGHT = {
  ...RESULT,
  startedAt: "2026-10-15T23:59:00+09:00",
  endedAt: "2026-10-16T00:30:00+09:00",
};

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe("ResultView · S07 피드백 결과", () => {
  describe("화면 표시", () => {
    it("자정을 넘겨 끝나도 [오늘의 성장 리뷰 보기]는 시작한 한국 날짜의 성장 리뷰로 간다", () => {
      render(<ResultView result={PAST_MIDNIGHT} />);

      expect(screen.getByRole("link", { name: "오늘의 성장 리뷰 보기" }).getAttribute("href")).toBe(
        "/reviews/2026-10-15?from=result",
      );
    });
  });
});
