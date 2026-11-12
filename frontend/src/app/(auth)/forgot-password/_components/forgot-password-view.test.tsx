// 기준: Figma [보류] S01-2 비밀번호 찾기(18:3300) · 회원가입과 같은 방식(새로 들어오면 새로 그리고, 뒤로 · 앞으로 가기면 그대로)
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { router } from "@/test/next-navigation";

import { ForgotPasswordView } from "./forgot-password-view";

// 경계 mock: Next 라우터(bfcacheId) · 서버 액션(1.8) · 연출(motion)
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("@/lib/auth/actions", () => ({ requestPasswordReset: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

describe("ForgotPasswordView · 비밀번호 찾기 화면", () => {
  describe("상태 변화", () => {
    it("새로 들어오면 입력한 이메일을 비운 입력 화면을 그린다", () => {
      const { rerender } = render(<ForgotPasswordView />);
      fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "a@ssafy.com" } });

      router.bfcacheId = "entry-2";
      rerender(<ForgotPasswordView />);

      expect((screen.getByLabelText("이메일") as HTMLInputElement).value).toBe("");
    });
  });
});
