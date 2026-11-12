// 기준: Figma [보류] S01-2 비밀번호 찾기(18:3300: ① 입력 · ② 보낸 뒤) · Swagger 1.8 비밀번호 찾기 메일 요청
// · 사용자 결정(2026-11-08: 다시 보내기 30초)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestPasswordReset, type AuthActionResult } from "@/lib/auth/actions";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import { spyTimers } from "@/test/timers";

import { ForgotPasswordForm } from "./forgot-password-form";

// 경계 mock: 서버 액션(1.8)과 연출(motion). 다시 보내기 30초는 가짜 타이머로 넘긴다
vi.mock("@/lib/auth/actions", () => ({ requestPasswordReset: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

beforeEach(() => {
  vi.useFakeTimers();
});

const EMAIL = "a@ssafy.com";
const RETRY = "잠시 후 다시 시도해 주세요.";

const sendButton = () =>
  screen.getByRole("button", { name: "재설정 링크 보내기" }) as HTMLButtonElement;

async function typeEmail(email: string) {
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: email } });
  await flushPromises();
}

async function submit(email = EMAIL) {
  await typeEmail(email);
  fireEvent.click(sendButton());
  await flushPromises();
}

/** 1초 타이머가 다시 그린 뒤 다음 타이머를 거므로 1초씩 넘긴다 */
async function passSeconds(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  }
}

/** 보낸 뒤 화면에서 30초를 넘겨 [다시 보내기]를 누를 수 있게 한다 */
async function sentAndWaited() {
  vi.mocked(requestPasswordReset).mockResolvedValue({ ok: true });
  render(<ForgotPasswordForm />);
  await submit();
  await passSeconds(30);
}

describe("ForgotPasswordForm · 비밀번호 찾기", () => {
  describe("메일 요청", () => {
    describe("화면 표시", () => {
      it("이메일 형식이 맞아야 [재설정 링크 보내기]를 누를 수 있다", async () => {
        render(<ForgotPasswordForm />);

        await typeEmail("not-email");
        expect(sendButton().disabled).toBe(true);

        await typeEmail(EMAIL);
        expect(sendButton().disabled).toBe(false);
      });

      it("입력한 글자를 모두 지우면 칸을 벗어난 뒤에야 이메일 안내를 보인다", async () => {
        render(<ForgotPasswordForm />);
        await typeEmail("a");
        await typeEmail("");
        expect(screen.queryByRole("alert")).toBeNull();

        fireEvent.blur(screen.getByLabelText("이메일"));
        await flushPromises();

        expect(screen.getByRole("alert").textContent).toBe("이메일을 입력해 주세요.");
      });
    });

    describe("사용자 조작", () => {
      it("보내면 보낸 뒤 화면에 입력한 이메일을 보이고 제목으로 포커스를 옮긴다", async () => {
        vi.mocked(requestPasswordReset).mockResolvedValue({ ok: true });
        render(<ForgotPasswordForm />);

        await submit();

        const title = screen.getByRole("heading", { name: "메일을 보냈어요!" });
        expect(document.activeElement).toBe(title);
        expect(screen.getByText(EMAIL)).toBeDefined();
      });
    });

    describe("오류 처리", () => {
      it("서버가 이메일을 거절하면 칸 아래에 이유를 보인다", async () => {
        vi.mocked(requestPasswordReset).mockResolvedValue({
          fieldErrors: { email: "이메일 형식이 아닙니다." },
        });
        render(<ForgotPasswordForm />);

        await submit();

        expect(screen.getByRole("alert").textContent).toBe("이메일 형식이 아닙니다.");
        expect(screen.getByLabelText("이메일").getAttribute("aria-invalid")).toBe("true");
      });

      it("서버가 실패 문구를 주면 입력 화면에 남아 문구를 보인다", async () => {
        vi.mocked(requestPasswordReset).mockResolvedValue({ formError: RETRY });
        render(<ForgotPasswordForm />);

        await submit();

        expect(screen.getByRole("alert").textContent).toBe(RETRY);
        expect(screen.queryByRole("heading", { name: "메일을 보냈어요!" })).toBeNull();
      });

      it("다시 보내면 이전 실패 문구를 지운다", async () => {
        vi.mocked(requestPasswordReset).mockResolvedValue({ formError: RETRY });
        render(<ForgotPasswordForm />);
        await submit();
        const second = deferred<AuthActionResult>();
        vi.mocked(requestPasswordReset).mockReturnValue(second.promise);

        fireEvent.click(sendButton());
        await flushPromises();

        expect(screen.queryByRole("alert")).toBeNull();
        await act(async () => second.resolve({ ok: true }));
      });
    });
  });

  describe("다시 보내기", () => {
    describe("사용자 조작", () => {
      it("다시 보내기에 성공하면 30초를 다시 센다", async () => {
        await sentAndWaited();

        fireEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
        await flushPromises();

        expect(screen.getByText("다시 보내기 (30초 후)")).toBeDefined();
        expect(screen.queryByRole("button", { name: "다시 보내기" })).toBeNull();
      });
    });

    describe("오류 처리", () => {
      it("다시 보내기가 실패하면 문구를 보이고 다시 누를 수 있다", async () => {
        await sentAndWaited();
        vi.mocked(requestPasswordReset).mockResolvedValue({ formError: RETRY });

        fireEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
        await flushPromises();

        expect(screen.getByRole("alert").textContent).toBe(RETRY);
        expect(
          (screen.getByRole("button", { name: "다시 보내기" }) as HTMLButtonElement).disabled,
        ).toBe(false);
      });

      it("실패 문구가 없으면 이메일 칸 오류를 문구로 보인다", async () => {
        await sentAndWaited();
        vi.mocked(requestPasswordReset).mockResolvedValue({
          fieldErrors: { email: "이메일 형식이 아닙니다." },
        });

        fireEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
        await flushPromises();

        expect(screen.getByRole("alert").textContent).toBe("이메일 형식이 아닙니다.");
      });

      it("다시 보내면 이전 실패 문구를 지운다", async () => {
        await sentAndWaited();
        vi.mocked(requestPasswordReset).mockResolvedValue({ formError: RETRY });
        fireEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
        await flushPromises();
        const second = deferred<AuthActionResult>();
        vi.mocked(requestPasswordReset).mockReturnValue(second.promise);

        fireEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
        await flushPromises();

        expect(screen.queryByRole("alert")).toBeNull();
        await act(async () => second.resolve({ ok: true }));
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("다시 보내는 동안에는 '보내는 중…'으로 바뀌고 누를 수 없다", async () => {
        await sentAndWaited();
        const resent = deferred<AuthActionResult>();
        vi.mocked(requestPasswordReset).mockReturnValue(resent.promise);

        fireEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
        await flushPromises();

        const pending = screen.getByRole("button", { name: "보내는 중…" }) as HTMLButtonElement;
        expect(pending.disabled).toBe(true);
        fireEvent.click(pending);
        expect(requestPasswordReset).toHaveBeenCalledTimes(2);
        await act(async () => resent.resolve({ ok: true }));
      });
    });

    describe("시간 경과", () => {
      it("보낸 뒤 30초 동안은 남은 초를 보이고 누를 수 없다", async () => {
        vi.mocked(requestPasswordReset).mockResolvedValue({ ok: true });
        render(<ForgotPasswordForm />);
        await submit();

        await passSeconds(29);

        expect(screen.getByText("다시 보내기 (1초 후)")).toBeDefined();
        expect(screen.queryByRole("button", { name: "다시 보내기" })).toBeNull();
      });

      it("30초가 지나면 [다시 보내기]를 누를 수 있다", async () => {
        vi.mocked(requestPasswordReset).mockResolvedValue({ ok: true });
        render(<ForgotPasswordForm />);
        await submit();

        await passSeconds(30);

        expect(
          (screen.getByRole("button", { name: "다시 보내기" }) as HTMLButtonElement).disabled,
        ).toBe(false);
      });
    });

    describe("정리", () => {
      it("보낸 뒤 화면을 떠나면 초 세기를 멈춘다", async () => {
        vi.mocked(requestPasswordReset).mockResolvedValue({ ok: true });
        const timers = spyTimers();
        const { unmount } = render(<ForgotPasswordForm />);
        await submit();

        unmount();

        expect(timers.cleared("timeout", 1000)).toBe(true);
      });
    });
  });
});
