import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForgotPasswordForm, RESEND_WAIT_SECONDS } from "./forgot-password-form";

// 서버 액션 경계만 바꾼다. 1.8 요청 본문 · 오류 변환은 actions.test.ts · auth.pact.test.ts가 본다.
// 기준: Figma [보류] S01-2 비밀번호 찾기(18:3300) · 사용자 결정(2026-11-08: 다시 보내기 30초). 모션은 끄고, 시간은 가짜 타이머로 넘긴다.
const requestPasswordReset = vi.fn();
vi.mock("@/lib/auth/actions", () => ({
  requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
}));

beforeEach(() => {
  vi.useFakeTimers();
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  MotionGlobalConfig.skipAnimations = false;
});

async function submit(email: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: email } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "재설정 링크 보내기" }));
  });
}

async function passSeconds(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  }
}

describe("ForgotPasswordForm", () => {
  it("이메일을 보내면(폼이 앞뒤 공백을 지운다) 보낸 뒤 화면으로 바뀌고 제목으로 포커스를 옮긴다", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true });
    render(<ForgotPasswordForm />);

    await submit(" a@ssafy.com ");

    expect(requestPasswordReset).toHaveBeenCalledWith({ email: "a@ssafy.com" });
    const title = screen.getByRole("heading", { name: "메일을 보냈어요!" });
    expect(document.activeElement).toBe(title);
    expect(screen.getByText(/a@ssafy\.com/).textContent).toBe("a@ssafy.com");
    expect(screen.getByRole("link", { name: "로그인으로 돌아가기" }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("다시 보내기는 30초 뒤에 누를 수 있고, 다시 보내면 30초를 다시 센다", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true });
    render(<ForgotPasswordForm />);
    await submit("a@ssafy.com");

    expect(screen.getByText(`다시 보내기 (${RESEND_WAIT_SECONDS}초 후)`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다시 보내기" })).toBeNull();

    await passSeconds(RESEND_WAIT_SECONDS - 1);
    expect(screen.getByText("다시 보내기 (1초 후)")).toBeTruthy();
    await passSeconds(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
    });
    expect(requestPasswordReset).toHaveBeenLastCalledWith({ email: "a@ssafy.com" });
    expect(requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(screen.getByText(`다시 보내기 (${RESEND_WAIT_SECONDS}초 후)`)).toBeTruthy();
  });

  it("다시 보내기가 실패하면 문구를 보이고 다시 누를 수 있다", async () => {
    requestPasswordReset.mockResolvedValue({ ok: true });
    render(<ForgotPasswordForm />);
    await submit("a@ssafy.com");
    await passSeconds(RESEND_WAIT_SECONDS);
    requestPasswordReset.mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
    });

    expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요.");
    expect(screen.getByRole("button", { name: "다시 보내기" })).toBeTruthy();
  });

  it("서버가 거절하면 입력 화면에 남아 이유를 보인다", async () => {
    requestPasswordReset.mockResolvedValue({
      fieldErrors: { email: "이메일 형식이 아닙니다." },
      formError: "잠시 후 다시 시도해 주세요.",
    });
    render(<ForgotPasswordForm />);

    await submit("a@ssafy.com");

    // 칸 오류 문구와 폼 오류 문구가 각각 alert로 보인다
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "이메일 형식이 아닙니다.",
      "잠시 후 다시 시도해 주세요.",
    ]);
    expect(screen.queryByRole("heading", { name: "메일을 보냈어요!" })).toBeNull();
  });

  it("이메일 형식이 맞아야 보낼 수 있다", async () => {
    render(<ForgotPasswordForm />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "not-email" } });
    });

    expect(
      (screen.getByRole("button", { name: "재설정 링크 보내기" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("link", { name: "‹ 로그인으로" }).getAttribute("href")).toBe("/login");
  });
});
