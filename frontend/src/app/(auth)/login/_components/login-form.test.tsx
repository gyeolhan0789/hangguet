// 기준: Figma S01 로그인(18:1556) · 기획 메모 S01-3(423:2140: 카카오 로그인 · 가입 실패는 S01 로그인 버튼 위 오류 문구 자리에,
// 이메일 로그인 오류와 같은 자리) · 사용자 결정(2026-11-05: 다시 와도 지난 이메일 · 비밀번호를 남기지 않음)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { login } from "@/lib/auth/actions";
import { useLoginNoticeStore } from "@/stores/login-notice-store";
import { flushPromises } from "@/test/flush";

import { LoginForm } from "./login-form";

// 경계 mock: 서버 액션(1.3 로그인 · 카카오 인가 시작)과 연출(motion). 문구 store는 실제로 쓴다
vi.mock("@/lib/auth/actions", () => ({ login: vi.fn() }));
vi.mock("@/lib/auth/social-actions", () => ({ startKakaoLogin: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

beforeEach(() => {
  useLoginNoticeStore.setState({ notice: null });
});

const KAKAO_FAILED = "소셜 로그인에 실패했어요. 다시 시도해 주세요.";
const LOGIN_FAILED = "이메일 또는 비밀번호를 확인해 주세요.";

const alerts = () => screen.queryAllByRole("alert").map((alert) => alert.textContent);
const emailInput = () => screen.getByLabelText("이메일") as HTMLInputElement;
const passwordInput = () =>
  screen.getByLabelText("비밀번호", { selector: "input" }) as HTMLInputElement;

function showNotice(text: string) {
  act(() => useLoginNoticeStore.getState().show(text));
}

async function submitLogin() {
  fireEvent.change(emailInput(), { target: { value: "a@ssafy.com" } });
  fireEvent.change(passwordInput(), { target: { value: "abcd1234" } });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));
  await flushPromises();
}

describe("LoginForm · 로그인 폼", () => {
  describe("사용자 조작", () => {
    it("입력해 [로그인]하면 그 값으로 로그인을 요청한다", async () => {
      vi.mocked(login).mockResolvedValue({});
      render(<LoginForm />);

      await submitLogin();

      expect(login).toHaveBeenCalledWith({ email: "a@ssafy.com", password: "abcd1234" });
    });
  });

  describe("오류 처리", () => {
    it("로그인이 실패하면 그 문구가 카카오 실패 문구를 대신한다", async () => {
      vi.mocked(login).mockResolvedValue({ formError: LOGIN_FAILED });
      render(<LoginForm />);
      showNotice(KAKAO_FAILED);

      await submitLogin();

      expect(alerts()).toEqual([LOGIN_FAILED]);
    });

    it("서버가 칸을 거절하면 그 칸 아래에 이유를 보인다", async () => {
      vi.mocked(login).mockResolvedValue({ fieldErrors: { email: "이메일 형식이 아닙니다." } });
      render(<LoginForm />);

      await submitLogin();

      expect(alerts()).toEqual(["이메일 형식이 아닙니다."]);
      expect(emailInput().getAttribute("aria-invalid")).toBe("true");
    });

    it("실패 문구 없이 끝나면(칸 오류만) 남은 문구를 지운다", async () => {
      vi.mocked(login).mockResolvedValue({
        fieldErrors: { password: "비밀번호를 확인해 주세요." },
      });
      render(<LoginForm />);
      showNotice(KAKAO_FAILED);

      await submitLogin();

      expect(alerts()).toEqual(["비밀번호를 확인해 주세요."]);
    });
  });

  describe("정리", () => {
    it("화면을 떠나면 오류 문구를 지운다", () => {
      const { unmount } = render(<LoginForm />);
      showNotice(KAKAO_FAILED);

      unmount();

      expect(useLoginNoticeStore.getState().notice).toBeNull();
    });

    it("화면이 숨겨지면 입력한 이메일 · 비밀번호를 비운다", () => {
      const { rerender } = render(
        <Activity mode="visible">
          <LoginForm />
        </Activity>,
      );
      fireEvent.change(emailInput(), { target: { value: "a@ssafy.com" } });
      fireEvent.change(passwordInput(), { target: { value: "abcd1234" } });

      rerender(
        <Activity mode="hidden">
          <LoginForm />
        </Activity>,
      );
      rerender(
        <Activity mode="visible">
          <LoginForm />
        </Activity>,
      );

      expect(emailInput().value).toBe("");
      expect(passwordInput().value).toBe("");
    });
  });
});
