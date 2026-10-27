import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WithdrawModal } from "./withdraw-modal";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 서버 액션 경계만 바꾼다. 탈퇴 요청 · 이동은 E2E(settings.spec.ts)가 본다.
const withdraw = vi.fn();
vi.mock("@/lib/user/actions", () => ({ withdraw: (...args: unknown[]) => withdraw(...args) }));

// 기준: 기획 · 모션 메모 S09-1(18:1251 · 18:3261: 회원 탈퇴 → 확인 모달) · WAI-ARIA APG 대화상자 패턴(aria-modal: 안에서만 Tab이 돈다,
// Esc로 닫힌다). 처리 중에는 Esc로 닫지 않는다.

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const dialog = () => screen.getByRole("dialog", { name: "정말 탈퇴할까요?" });

describe("WithdrawModal (탈퇴 확인 모달)", () => {
  it("닫혀 있으면 그리지 않고, 열리면 비밀번호 칸에 포커스가 간다", () => {
    const { rerender } = render(<WithdrawModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<WithdrawModal open onClose={vi.fn()} />);

    expect(document.activeElement).toBe(screen.getByLabelText("비밀번호", { selector: "input" }));
  });

  it("Tab · Shift+Tab은 모달 안에서만 돈다(마지막 [탈퇴하기] ↔ 첫 비밀번호 칸)", () => {
    render(<WithdrawModal open onClose={vi.fn()} />);
    const input = screen.getByLabelText("비밀번호", { selector: "input" });
    const submit = screen.getByRole("button", { name: "탈퇴하기" });

    submit.focus();
    fireEvent.keyDown(dialog(), { key: "Tab" });
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(dialog(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit);
  });

  it("Esc를 누르면 닫는다", () => {
    const onClose = vi.fn();
    render(<WithdrawModal open onClose={onClose} />);

    fireEvent.keyDown(dialog(), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("탈퇴를 처리하는 동안에는 Esc · [취소]로 닫지 않는다", async () => {
    withdraw.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    render(<WithdrawModal open onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("비밀번호", { selector: "input" }), {
      target: { value: "password1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "탈퇴하기" }));
    await screen.findByRole("button", { name: "탈퇴하기", busy: true });
    fireEvent.keyDown(dialog(), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true);
  });
});
