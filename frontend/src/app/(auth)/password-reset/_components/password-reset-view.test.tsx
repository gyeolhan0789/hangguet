// 기준: Swagger 1.9 비밀번호 재설정(메일 링크의 token) · 회원가입과 같은 방식(새 링크로 들어올 때마다 새로 그린다)
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetPassword } from "@/lib/auth/actions";
import { flushPromises } from "@/test/flush";
import { router } from "@/test/next-navigation";

import { PasswordResetView } from "./password-reset-view";

// 경계 mock: Next 라우터(bfcacheId) · 서버 액션(1.9) · 주소 바꾸기(history.replaceState) · 연출(motion)
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("@/lib/auth/actions", () => ({ resetPassword: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 주소를 실제로 바꾸면 jsdom 주소가 다음 테스트로 넘어가므로 막고 넘긴 주소만 본다
beforeEach(() => {
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
});
const replaceState = () => vi.mocked(window.history.replaceState);

const VALID = "abcd1234";

const passwordInput = () => screen.getByLabelText("새 비밀번호") as HTMLInputElement;

async function fillAndSubmit() {
  fireEvent.change(passwordInput(), { target: { value: VALID } });
  fireEvent.change(screen.getByLabelText("비밀번호 확인"), { target: { value: VALID } });
  await flushPromises();
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 바꾸기" }));
  await flushPromises();
}

describe("PasswordResetView · 재설정 링크 화면", () => {
  describe("화면 표시", () => {
    it("token이 있으면 주소에서 token을 지운다", () => {
      render(<PasswordResetView token="link-token" />);

      expect(replaceState()).toHaveBeenCalledTimes(1);
      expect(String(replaceState().mock.calls[0][2])).not.toContain("link-token");
    });
  });

  describe("상태 변화", () => {
    it("token을 지워 token 없이 다시 그려져도 처음 받은 token으로 비밀번호를 바꾼다", async () => {
      vi.mocked(resetPassword).mockResolvedValue({ ok: true });
      const { rerender } = render(<PasswordResetView token="link-token" />);
      rerender(<PasswordResetView token="" />);

      await fillAndSubmit();

      expect(vi.mocked(resetPassword).mock.calls[0][0]).toBe("link-token");
    });

    it("다른 token으로 들어오면 새 token으로 폼을 새로 그린다", async () => {
      vi.mocked(resetPassword).mockResolvedValue({ ok: true });
      const { rerender } = render(<PasswordResetView token="old-token" />);
      fireEvent.change(passwordInput(), { target: { value: VALID } });

      rerender(<PasswordResetView token="new-token" />);

      expect(passwordInput().value).toBe("");
      await fillAndSubmit();
      expect(vi.mocked(resetPassword).mock.calls[0][0]).toBe("new-token");
    });

    it("새로 들어오면 입력한 비밀번호를 비운 폼을 그린다", () => {
      const { rerender } = render(<PasswordResetView token="link-token" />);
      fireEvent.change(passwordInput(), { target: { value: VALID } });

      router.bfcacheId = "entry-2";
      rerender(<PasswordResetView token="link-token" />);

      expect(passwordInput().value).toBe("");
    });
  });

  describe("경계값", () => {
    it("token이 없으면 주소를 건드리지 않는다", () => {
      render(<PasswordResetView token="" />);

      expect(replaceState()).not.toHaveBeenCalled();
    });
  });
});
