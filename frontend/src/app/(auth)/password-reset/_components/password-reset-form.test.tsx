import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PasswordResetForm } from "./password-reset-form";

// 서버 액션 경계만 바꾼다. 1.9 요청 본문 · 오류 변환 · 쿠키 삭제는 actions.test.ts · auth.pact.test.ts가 본다.
// 기준: Swagger 1.9 비밀번호 재설정 · 사용자 결정(2026-11-08: 회원가입 틀, 성공 · 링크 무효 화면). 모션은 끄고 본다.
const resetPassword = vi.fn();
vi.mock("@/lib/auth/actions", () => ({
  resetPassword: (...args: unknown[]) => resetPassword(...args),
}));

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  MotionGlobalConfig.skipAnimations = false;
});

async function submit(password: string, passwordConfirm = password) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("새 비밀번호"), { target: { value: password } });
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("비밀번호 확인"), {
      target: { value: passwordConfirm },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 바꾸기" }));
  });
}

describe("PasswordResetForm", () => {
  it("바꾸면 성공 화면으로 바뀌고, 로그인으로 보낸다", async () => {
    resetPassword.mockResolvedValue({ ok: true });
    render(<PasswordResetForm token="token-1" />);

    await submit("efgh5678");

    expect(resetPassword).toHaveBeenCalledWith("token-1", {
      password: "efgh5678",
      passwordConfirm: "efgh5678",
    });
    const title = screen.getByRole("heading", { name: "비밀번호를 바꿨어요" });
    expect(document.activeElement).toBe(title);
    expect(screen.getByRole("link", { name: "로그인하러 가기" }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("링크가 만료됐으면 서버 문구와 다시 받기를 보인다", async () => {
    resetPassword.mockResolvedValue({
      linkInvalid: true,
      formError: "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.",
    });
    render(<PasswordResetForm token="used" />);

    await submit("efgh5678");

    expect(screen.getByRole("alert").textContent).toBe(
      "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.",
    );
    expect(screen.getByRole("link", { name: "재설정 링크 다시 받기" }).getAttribute("href")).toBe(
      "/forgot-password",
    );
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "새 비밀번호 설정" }));
  });

  it("서버 문구 없이 링크 무효면 기본 문구를 보인다", async () => {
    resetPassword.mockResolvedValue({ linkInvalid: true });
    render(<PasswordResetForm token="x" />);

    await submit("efgh5678");

    expect(screen.getByRole("alert").textContent).toBe(
      "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.",
    );
  });

  it("주소에 token이 없으면 처음부터 다시 받기 화면이다", () => {
    render(<PasswordResetForm token="" />);

    expect(screen.queryByLabelText("새 비밀번호")).toBeNull();
    expect(screen.getByRole("link", { name: "재설정 링크 다시 받기" })).toBeTruthy();
  });

  it("서버가 새 비밀번호를 거절하면 칸 아래에 이유를 보인다", async () => {
    resetPassword.mockResolvedValue({
      fieldErrors: { newPassword: "8~64자, 영문과 숫자를 모두 포함해야 합니다." },
    });
    render(<PasswordResetForm token="token-1" />);

    await submit("efgh5678");

    expect(screen.getByText("8~64자, 영문과 숫자를 모두 포함해야 합니다.")).toBeTruthy();
    expect(screen.getByLabelText("새 비밀번호")).toBeTruthy();
  });

  it("링크는 쓸 수 있는데 서버가 실패하면 입력 화면에 남아 문구를 보인다", async () => {
    resetPassword.mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
    render(<PasswordResetForm token="token-1" />);

    await submit("efgh5678");

    expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요.");
    expect(screen.getByLabelText("새 비밀번호")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "재설정 링크 다시 받기" })).toBeNull();
  });

  it("비밀번호 확인이 다르면 보낼 수 없다", async () => {
    render(<PasswordResetForm token="token-1" />);

    await submit("efgh5678", "efgh5679");

    expect(screen.getByText("비밀번호가 일치하지 않아요.")).toBeTruthy();
    expect(resetPassword).not.toHaveBeenCalled();
  });
});
