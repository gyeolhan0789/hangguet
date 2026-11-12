// 기준: Figma S01 로그인 · S01-1 회원가입 제출 버튼 · 모션 메모 S01(비활성에서 활성이 되는 순간 살짝 튐)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SubmitButton } from "./submit-button";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

describe("SubmitButton · 폼 제출 버튼", () => {
  describe("화면 표시", () => {
    it("기다리는 중이면 기다리는 문구로 바꾸고 바쁨 표시가 되며 누를 수 없다", () => {
      render(
        <SubmitButton pendingText="로그인 중…" pending>
          로그인
        </SubmitButton>,
      );

      const button = screen.getByRole("button", { name: "로그인 중…" });
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect(button.hasAttribute("disabled")).toBe(true);
    });
  });
});
