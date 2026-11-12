// 기준: Figma S08 7일 동그라미(18:2710: 최근 7일) · S08-C(18:4720: '오늘 · +1 … +6') · 기획 메모 S08-C(18:3736)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { reviewWeek } from "@/lib/growth/review";
import { GROWTH_REVIEW } from "@/test/growth-review-examples";

import { ReviewWeek } from "./review-week";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 7.1 200 예시 'S08 오늘의 성장 리뷰'(최근 7일 중 10-11 · 10-12 · 10-13만 연습한 것으로 바꿈) · 'S08-C 첫 면접'
const S08 = {
  ...GROWTH_REVIEW.S08,
  practiceDates: ["2026-10-11", "2026-10-12", "2026-10-13"],
};
const { FIRST } = GROWTH_REVIEW;

describe("ReviewWeek · 성장 리뷰 7일 동그라미", () => {
  describe("화면 표시", () => {
    it.each([
      { label: "첫 연습일 아님", review: S08, first: false, name: "최근 7일 연습" },
      { label: "첫 연습일", review: FIRST, first: true, name: "앞으로의 7일" },
    ])("'$label'이면 '$name' 목록으로 보여 준다", ({ review, first, name }) => {
      render(
        <ReviewWeek
          days={reviewWeek(review, true)}
          streak={review.streakOnDate}
          first={first}
          today
        />,
      );

      expect(screen.getByRole("list", { name })).toBeDefined();
    });
  });
});
