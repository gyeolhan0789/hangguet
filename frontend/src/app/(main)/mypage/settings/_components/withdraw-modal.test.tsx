import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WithdrawModal } from "./withdraw-modal";

// 서버 액션 경계만 바꾼다. 탈퇴 요청 · 이동은 E2E(settings.spec.ts)가 본다.
const withdraw = vi.fn();
const withdrawSocial = vi.fn();
vi.mock("@/lib/user/actions", () => ({
  withdraw: (...args: unknown[]) => withdraw(...args),
  withdrawSocial: (...args: unknown[]) => withdrawSocial(...args),
}));

// 기준: 기획 · 모션 메모 S09-1(18:1251 · 18:3261: 회원 탈퇴 → 확인 모달) · WAI-ARIA APG 대화상자 패턴(aria-modal: 안에서만 Tab이 돈다,
// Esc로 닫힌다). 처리 중에는 Esc로 닫지 않는다.

// 처리 중인 서버 액션은 테스트가 끝날 때 푼다(끝나지 않는 트랜지션이 다음 테스트로 이어지지 않게). 모션은 끄고 본다.
const releases: (() => void)[] = [];
function pending<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (release = resolve));
  releases.push(() => release({} as T));
  return promise;
}

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(async () => {
  await act(async () => releases.splice(0).forEach((release) => release()));
  cleanup();
  vi.resetAllMocks();
  MotionGlobalConfig.skipAnimations = false;
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
    withdraw.mockReturnValue(pending());
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

describe("WithdrawModal (소셜 회원)", () => {
  // 기준: Swagger 2.7 WithdrawRequest.password "소셜 회원은 보내지 않는다" · 기획 메모 S09-1(소셜 회원은 2.7에 비밀번호를 보내지 않음)

  it("비밀번호 칸 없이 열리고, 포커스는 [취소]로 간다", () => {
    render(<WithdrawModal open social onClose={vi.fn()} />);

    expect(screen.queryByLabelText("비밀번호", { selector: "input" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "취소" }));
  });

  it("[탈퇴하기]는 비밀번호 없이 탈퇴한다(withdrawSocial)", async () => {
    withdrawSocial.mockReturnValue(pending());
    render(<WithdrawModal open social onClose={vi.fn()} />);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "탈퇴하기" })));

    expect(withdrawSocial).toHaveBeenCalledWith();
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("Tab · Shift+Tab은 모달 안에서만 돈다(마지막 [탈퇴하기] ↔ 첫 [취소])", () => {
    render(<WithdrawModal open social onClose={vi.fn()} />);
    const cancel = screen.getByRole("button", { name: "취소" });
    const submit = screen.getByRole("button", { name: "탈퇴하기" });

    submit.focus();
    fireEvent.keyDown(dialog(), { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(dialog(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit);
  });

  it("탈퇴를 처리하는 동안에는 Esc · [취소]로 닫지 않는다", async () => {
    withdrawSocial.mockReturnValue(pending());
    const onClose = vi.fn();
    render(<WithdrawModal open social onClose={onClose} />);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "탈퇴하기" })));
    fireEvent.keyDown(dialog(), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true);
  });

  it("실패하면 서버 문구를 보이고 포커스를 [취소]로 돌려준다(모달 안에 머문다)", async () => {
    withdrawSocial.mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
    render(<WithdrawModal open social onClose={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "탈퇴하기" });
    submit.focus();

    await act(async () => fireEvent.click(submit));

    expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "취소" }));
  });
});
