// 기준: Figma S06-E 면접 종료 확인(18:4299)과 같은 모양의 탈퇴 확인 모달 · Swagger 2.7 회원 탈퇴(WithdrawRequest · 400 PASSWORD_MISMATCH
// · 409 INTERVIEW_IN_PROGRESS, 소셜 회원은 비밀번호 없이) · 기획 메모 S09-1 · WAI-ARIA APG Dialog (Modal)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { withdraw, withdrawSocial } from "@/lib/user/actions";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { WithdrawModal } from "./withdraw-modal";

// 경계 mock: 서버 액션(2.7)과 연출(motion)
vi.mock("@/lib/user/actions", () => ({ withdraw: vi.fn(), withdrawSocial: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 2.7 400 · 409 예시 detail
const PASSWORD_MISMATCH = "비밀번호가 맞지 않아요.";
const INTERVIEW_IN_PROGRESS = "진행 중인 면접을 끝낸 뒤 탈퇴할 수 있어요.";

const password = () => screen.queryByLabelText<HTMLInputElement>("비밀번호", { selector: "input" });
const cancelButton = () => screen.getByRole("button", { name: "취소" });
const submitButton = () => screen.getByRole("button", { name: "탈퇴하기" });
/** dim(모달 바깥 배경) */
const dim = () => screen.getByRole("dialog").parentElement!;
/** 비밀번호 칸 아래 문구 */
const passwordMessage = () =>
  document.getElementById(password()?.getAttribute("aria-describedby") ?? "")?.textContent ?? null;

function renderModal({ open = true, social = false } = {}) {
  const onClose = vi.fn();
  const view = (isOpen: boolean) => (
    <WithdrawModal open={isOpen} social={social} onClose={onClose} />
  );
  const result = render(view(open));
  return { ...result, onClose, setOpen: (isOpen: boolean) => result.rerender(view(isOpen)) };
}

const typePassword = (value: string) => fireEvent.change(password()!, { target: { value } });

describe("WithdrawModal · 탈퇴 확인 모달", () => {
  describe("이메일 회원", () => {
    describe("화면 표시", () => {
      it("닫혀 있으면 그리지 않는다", () => {
        renderModal({ open: false });

        expect(screen.queryByRole("dialog")).toBeNull();
      });

      it("열리면 비밀번호 칸에 포커스를 준다", () => {
        renderModal();

        expect(screen.getByRole("dialog", { name: "정말 탈퇴할까요?" })).toBeDefined();
        expect(document.activeElement).toBe(password());
      });
    });

    describe("사용자 조작", () => {
      it("Esc를 누르면 닫기를 요청한다", () => {
        const { onClose } = renderModal();

        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        expect(onClose).toHaveBeenCalledTimes(1);
      });

      it("dim을 누르면 닫기를 요청한다", () => {
        const { onClose } = renderModal();

        fireEvent.mouseDown(dim());

        expect(onClose).toHaveBeenCalledTimes(1);
      });

      it("모달 안을 누르면 닫기를 요청하지 않는다", () => {
        const { onClose } = renderModal();

        fireEvent.mouseDown(screen.getByRole("dialog"));

        expect(onClose).not.toHaveBeenCalled();
      });

      it("Tab은 비밀번호 칸과 버튼 사이에서만 돈다", () => {
        renderModal();
        submitButton().focus();

        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });

        expect(document.activeElement).toBe(password());
      });
      it("[탈퇴하기]를 누르면 입력한 비밀번호로 탈퇴를 요청한다", async () => {
        vi.mocked(withdraw).mockResolvedValue({});
        renderModal();
        typePassword("password123");

        fireEvent.click(submitButton());
        await flushPromises();

        expect(withdraw).toHaveBeenCalledWith({ password: "password123" });
      });
    });

    describe("입력 검증", () => {
      it("비밀번호가 비면 보내지 않고 칸 아래에 문구를 보여 준다", async () => {
        renderModal();

        fireEvent.click(submitButton());
        await flushPromises();

        expect(withdraw).not.toHaveBeenCalled();
        expect(passwordMessage()).toBe("필수 값입니다.");
      });
    });

    describe("오류 처리", () => {
      it.each([
        {
          label: "칸 오류",
          result: { fieldErrors: { password: PASSWORD_MISMATCH } },
          text: PASSWORD_MISMATCH,
        },
        {
          label: "폼 오류",
          result: { formError: INTERVIEW_IN_PROGRESS },
          text: INTERVIEW_IN_PROGRESS,
        },
      ])("서버가 '$label'를 주면 비밀번호 칸 아래에 문구를 보여 준다", async ({ result, text }) => {
        vi.mocked(withdraw).mockResolvedValue(result);
        renderModal();
        typePassword("password123");

        fireEvent.click(submitButton());
        await flushPromises();

        expect(passwordMessage()).toBe(text);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("처리하는 동안에는 Esc · dim · [취소]로 닫지 않는다", async () => {
        const withdrawing = deferred<Record<string, never>>();
        vi.mocked(withdraw).mockReturnValue(withdrawing.promise);
        const { onClose } = renderModal();
        typePassword("password123");
        fireEvent.click(submitButton());
        await flushPromises();

        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        fireEvent.mouseDown(dim());
        fireEvent.click(cancelButton());

        expect(onClose).not.toHaveBeenCalled();
        await act(async () => withdrawing.resolve({}));
      });
    });

    describe("정리", () => {
      it("닫았다 다시 열면 입력한 비밀번호와 오류를 지운다", async () => {
        vi.mocked(withdraw).mockResolvedValue({ fieldErrors: { password: PASSWORD_MISMATCH } });
        const { setOpen } = renderModal();
        typePassword("wrong123");
        fireEvent.click(submitButton());
        await flushPromises();

        setOpen(false);
        setOpen(true);

        expect(password()?.value).toBe("");
        expect(passwordMessage()).toBeNull();
      });
    });
  });

  describe("소셜 회원", () => {
    describe("화면 표시", () => {
      it("비밀번호 칸 없이 열고 [취소]에 포커스를 준다", () => {
        renderModal({ social: true });

        expect(password()).toBeNull();
        expect(document.activeElement).toBe(cancelButton());
      });
    });

    describe("사용자 조작", () => {
      it("[탈퇴하기]를 누르면 비밀번호 없이 탈퇴를 요청한다", async () => {
        vi.mocked(withdrawSocial).mockResolvedValue({});
        renderModal({ social: true });

        fireEvent.click(submitButton());
        await flushPromises();

        expect(withdrawSocial).toHaveBeenCalledTimes(1);
        expect(withdraw).not.toHaveBeenCalled();
      });
    });

    describe("오류 처리", () => {
      it("실패하면 서버 문구를 보여 주고 포커스를 [취소]로 돌려준다", async () => {
        vi.mocked(withdrawSocial).mockResolvedValue({ formError: INTERVIEW_IN_PROGRESS });
        renderModal({ social: true });
        submitButton().focus();

        fireEvent.click(submitButton());
        await flushPromises();

        expect(screen.getByRole("alert").textContent).toBe(INTERVIEW_IN_PROGRESS);
        expect(document.activeElement).toBe(cancelButton());
      });
    });
  });
});
