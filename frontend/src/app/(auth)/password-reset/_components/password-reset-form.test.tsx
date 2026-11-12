// 기준: Swagger 1.9 비밀번호 재설정(204 · 400 PASSWORD_RESET_TOKEN_INVALID · VALIDATION_FAILED) · PasswordResetConfirmRequest
// · 사용자 결정(2026-11-08: Figma 시안이 없어 회원가입 입력 틀 · 비밀번호 규칙 칩을 쓴다)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { resetPassword, type PasswordResetActionResult } from "@/lib/auth/actions";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { PasswordResetForm } from "./password-reset-form";

// 경계 mock: 서버 액션(1.9)과 연출(motion)
vi.mock("@/lib/auth/actions", () => ({ resetPassword: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

const TOKEN = "reset-token";
const VALID = "abcd1234";
const LINK_EXPIRED = "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.";
// 예시 데이터: Swagger 1.9 400 PASSWORD_RESET_TOKEN_INVALID의 detail은 기본 문구와 같아, 서버 문구를 보이는지 가리려고 바꾼 값
const LINK_USED = "이미 사용한 링크예요. 다시 요청해 주세요.";

const passwordInput = () => screen.getByLabelText("새 비밀번호");
const confirmInput = () => screen.getByLabelText("비밀번호 확인");
const changeButton = () =>
  screen.getByRole("button", { name: "비밀번호 바꾸기" }) as HTMLButtonElement;
const alerts = () => screen.queryAllByRole("alert").map((alert) => alert.textContent);

async function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  await flushPromises();
}

async function fillAndSubmit() {
  await type(passwordInput(), VALID);
  await type(confirmInput(), VALID);
  fireEvent.click(changeButton());
  await flushPromises();
}

describe("PasswordResetForm · 새 비밀번호 설정", () => {
  describe("화면 표시", () => {
    it("링크에 token이 없으면 처음부터 기본 문구와 [재설정 링크 다시 받기]를 보인다", () => {
      render(<PasswordResetForm token="" />);

      expect(screen.getByRole("alert").textContent).toBe(LINK_EXPIRED);
      expect(screen.getByRole("link", { name: "재설정 링크 다시 받기" })).toBeDefined();
    });

    it("처음부터 링크 무효 화면이면 제목으로 포커스를 옮기지 않는다", () => {
      render(<PasswordResetForm token="" />);

      expect(document.activeElement).not.toBe(
        screen.getByRole("heading", { name: "새 비밀번호 설정" }),
      );
    });

    it("비밀번호가 64자 이하면 규칙 오류 문구 대신 칩만 보인다", async () => {
      render(<PasswordResetForm token={TOKEN} />);

      await type(passwordInput(), "a".repeat(64));

      expect(alerts()).toEqual([]);
      expect(screen.getByRole("list")).toBeDefined();
    });

    it("비밀번호가 64자를 넘으면 칸 아래에 최대 길이 안내를 보인다", async () => {
      render(<PasswordResetForm token={TOKEN} />);

      await type(passwordInput(), `a1${"a".repeat(63)}`);

      expect(alerts()).toEqual(["비밀번호는 64자까지 쓸 수 있어요."]);
    });

    it("비밀번호 확인이 다르면 확인 칸 아래에 알린다", async () => {
      render(<PasswordResetForm token={TOKEN} />);

      await type(passwordInput(), VALID);
      await type(confirmInput(), "abcd12345");

      expect(alerts()).toEqual(["비밀번호가 일치하지 않아요."]);
      expect(confirmInput().getAttribute("aria-invalid")).toBe("true");
    });

    it("입력이 규칙에 맞아야 [비밀번호 바꾸기]를 누를 수 있다", async () => {
      render(<PasswordResetForm token={TOKEN} />);

      await type(passwordInput(), "abcdefgh");
      await type(confirmInput(), "abcdefgh");
      expect(changeButton().disabled).toBe(true);

      await type(passwordInput(), VALID);
      await type(confirmInput(), VALID);
      expect(changeButton().disabled).toBe(false);
    });
  });

  describe("사용자 조작", () => {
    it("바꾸면 완료 화면으로 바꾸고 제목으로 포커스를 옮긴다", async () => {
      vi.mocked(resetPassword).mockResolvedValue({ ok: true });
      render(<PasswordResetForm token={TOKEN} />);

      await fillAndSubmit();

      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "비밀번호를 바꿨어요" }),
      );
    });
  });

  describe("상태 변화", () => {
    it("확인 칸을 채운 뒤 비밀번호를 바꾸면 확인 칸을 다시 비교한다", async () => {
      render(<PasswordResetForm token={TOKEN} />);
      await type(passwordInput(), VALID);
      await type(confirmInput(), VALID);

      await type(passwordInput(), "abcd12345");

      expect(alerts()).toEqual(["비밀번호가 일치하지 않아요."]);
    });
  });

  describe("오류 처리", () => {
    it("링크가 무효면 서버 문구와 [재설정 링크 다시 받기]를 보인다", async () => {
      vi.mocked(resetPassword).mockResolvedValue({ linkInvalid: true, formError: LINK_USED });
      render(<PasswordResetForm token={TOKEN} />);

      await fillAndSubmit();

      expect(screen.getByRole("alert").textContent).toBe(LINK_USED);
      expect(screen.getByRole("link", { name: "재설정 링크 다시 받기" })).toBeDefined();
    });

    it("제출 뒤 링크가 무효면 제목으로 포커스를 옮긴다", async () => {
      vi.mocked(resetPassword).mockResolvedValue({ linkInvalid: true, formError: LINK_USED });
      render(<PasswordResetForm token={TOKEN} />);

      await fillAndSubmit();

      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "새 비밀번호 설정" }),
      );
    });

    it("서버 문구 없이 링크 무효면 기본 문구를 보인다", async () => {
      vi.mocked(resetPassword).mockResolvedValue({ linkInvalid: true });
      render(<PasswordResetForm token={TOKEN} />);

      await fillAndSubmit();

      expect(screen.getByRole("alert").textContent).toBe(LINK_EXPIRED);
    });

    it("서버가 새 비밀번호를 거절하면 64자 이하여도 칸 아래에 이유를 보인다", async () => {
      vi.mocked(resetPassword).mockResolvedValue({
        fieldErrors: { newPassword: "8~64자, 영문과 숫자를 모두 포함해야 합니다." },
      });
      render(<PasswordResetForm token={TOKEN} />);

      await fillAndSubmit();

      expect(alerts()).toEqual(["8~64자, 영문과 숫자를 모두 포함해야 합니다."]);
      expect(passwordInput().getAttribute("aria-invalid")).toBe("true");
    });

    it("그 밖의 실패면 입력 화면에 남아 문구를 보인다", async () => {
      vi.mocked(resetPassword).mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
      render(<PasswordResetForm token={TOKEN} />);

      await fillAndSubmit();

      expect(alerts()).toEqual(["잠시 후 다시 시도해 주세요."]);
      expect(changeButton()).toBeDefined();
    });

    it("다시 제출하면 이전 폼 오류를 지운다", async () => {
      vi.mocked(resetPassword).mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
      render(<PasswordResetForm token={TOKEN} />);
      await fillAndSubmit();
      const second = deferred<PasswordResetActionResult>();
      vi.mocked(resetPassword).mockReturnValue(second.promise);

      fireEvent.click(changeButton());
      await flushPromises();

      expect(alerts()).toEqual([]);
      await act(async () => second.resolve({ ok: true }));
    });
  });
});
