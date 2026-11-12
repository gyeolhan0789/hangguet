// 기준: Figma S01-1 회원가입 · Next useRouter().bfcacheId(새로 들어오면 새로 그리고, 뒤로 · 앞으로 가기면 그대로)
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { router } from "@/test/next-navigation";

import { SignupView } from "./signup-view";

// 경계 mock: Next 라우터(bfcacheId) · 서버 액션(1.1 · 1.2 · 카카오 인가 시작) · 연출(motion)
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("@/lib/auth/actions", () => ({ signup: vi.fn(), checkEmailAvailable: vi.fn() }));
vi.mock("@/lib/auth/social-actions", () => ({ startKakaoLogin: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

describe("SignupView · 회원가입 화면", () => {
  describe("상태 변화", () => {
    it("새로 들어오면 입력한 값을 비운 가입 폼을 그린다", () => {
      const { rerender } = render(<SignupView />);
      fireEvent.change(screen.getByLabelText("닉네임"), { target: { value: "면접왕" } });

      router.bfcacheId = "entry-2";
      rerender(<SignupView />);

      expect((screen.getByLabelText("닉네임") as HTMLInputElement).value).toBe("");
    });
  });
});
