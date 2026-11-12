// 기준: Figma S03 Action Bar(18:2106) · 모션 메모 S03([다음] 회색 → 주황 채움 + 팝) · 모션 메모 S05(18:2492: [면접 시작] 한 번 통통)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PracticeNextButton } from "./practice-action-bar";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

const next = () => screen.getByRole("button", { name: "다음" });

describe("PracticeNextButton · 연습 단계 다음 버튼", () => {
  describe("화면 표시", () => {
    it("기다리는 중이면 바쁨 표시가 되고 누를 수 없다", () => {
      render(<PracticeNextButton pending>다음</PracticeNextButton>);

      expect(next().getAttribute("aria-busy")).toBe("true");
      expect(next().hasAttribute("disabled")).toBe(true);
    });
  });
});
