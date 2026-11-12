// 기준: Figma S09-1 Row 비밀번호 변경(18:3157) · Swagger 2.3 비밀번호 변경(PasswordChangeRequest · 400 PASSWORD_MISMATCH) · 기획 메모 S09-1
// · 사용자 결정 2026-11-05(다른 화면에 갔다 오면 펼친 입력칸을 접고 입력한 비밀번호를 지운다)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changePassword } from "@/lib/user/actions";
import { useToastStore } from "@/stores/toast-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { PasswordRow } from "./password-row";

// 경계 mock: 서버 액션(2.3)과 연출(motion)
vi.mock("@/lib/user/actions", () => ({ changePassword: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

const row = () => screen.getByRole("button", { name: /비밀번호 변경/ });
const current = () =>
  screen.queryByLabelText<HTMLInputElement>("지금 비밀번호", { selector: "input" });
const next = () => screen.getByLabelText<HTMLInputElement>("새 비밀번호", { selector: "input" });
/** 입력칸 아래 문구(aria-describedby로 이은 칸 메시지) */
const messageOf = (input: HTMLElement) =>
  document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent ?? null;

/** 줄을 펼쳐 두 칸을 채운다 */
function renderFilled() {
  render(<PasswordRow />);
  fireEvent.click(row());
  fireEvent.change(current()!, { target: { value: "password123" } });
  fireEvent.change(next(), { target: { value: "newpass123" } });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "변경" }));

beforeEach(() => {
  useToastStore.setState({ toast: null });
});

describe("PasswordRow · 설정 비밀번호 변경 줄", () => {
  describe("사용자 조작", () => {
    it("줄을 누르면 입력칸을 펼치고 다시 누르면 접는다", () => {
      render(<PasswordRow />);

      fireEvent.click(row());
      expect(row().getAttribute("aria-expanded")).toBe("true");
      expect(current()).not.toBeNull();

      fireEvent.click(row());
      expect(row().getAttribute("aria-expanded")).toBe("false");
      expect(current()).toBeNull();
    });

    it("[취소]를 누르면 접고 입력한 비밀번호를 지운다", () => {
      renderFilled();

      fireEvent.click(screen.getByRole("button", { name: "취소" }));
      fireEvent.click(row());

      expect(current()?.value).toBe("");
      expect(next().value).toBe("");
    });
    it("바뀌면 접고 '비밀번호를 바꿨어요' 체크 토스트를 띄운다", async () => {
      vi.mocked(changePassword).mockResolvedValue({ ok: true });
      renderFilled();

      submit();
      await flushPromises();

      expect(current()).toBeNull();
      expect(useToastStore.getState().toast).toMatchObject({
        text: "비밀번호를 바꿨어요",
        icon: "/home/icon-check.svg",
      });
    });
  });

  describe("입력 검증", () => {
    it("규칙에 맞지 않으면 보내지 않고 칸마다 문구를 보여 준다", async () => {
      render(<PasswordRow />);
      fireEvent.click(row());

      submit();
      await flushPromises();

      expect(changePassword).not.toHaveBeenCalled();
      expect(messageOf(current()!)).toBe("필수 값입니다.");
      expect(messageOf(next())).toBe("8~64자, 영문과 숫자를 모두 포함해야 합니다.");
    });
  });

  describe("오류 처리", () => {
    it("지금 비밀번호가 틀렸다는 칸 오류를 받으면 그 칸 아래에 문구를 보여 준다", async () => {
      vi.mocked(changePassword).mockResolvedValue({
        fieldErrors: { currentPassword: "비밀번호가 맞지 않아요." },
      });
      renderFilled();

      submit();
      await flushPromises();

      expect(messageOf(current()!)).toBe("비밀번호가 맞지 않아요.");
      expect(messageOf(next())).toBeNull();
    });

    it("서버가 폼 오류를 주면 버튼 위에 문구를 보여 준다", async () => {
      vi.mocked(changePassword).mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
      renderFilled();

      submit();
      await flushPromises();

      expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요.");
      expect(messageOf(current()!)).toBeNull();
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("바꾸는 동안에는 [취소] · [변경]을 누를 수 없다", async () => {
      const saving = deferred<{ ok: true }>();
      vi.mocked(changePassword).mockReturnValue(saving.promise);
      renderFilled();

      submit();
      await flushPromises();

      expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "변경" }).hasAttribute("disabled")).toBe(true);
      await act(async () => saving.resolve({ ok: true }));
    });
  });

  describe("정리", () => {
    it("화면이 숨겨지면 접고 입력한 비밀번호를 지운다", () => {
      const view = (mode: "visible" | "hidden") => (
        <Activity mode={mode}>
          <PasswordRow />
        </Activity>
      );
      const { rerender } = render(view("visible"));
      fireEvent.click(row());
      fireEvent.change(current()!, { target: { value: "password123" } });

      rerender(view("hidden"));
      rerender(view("visible"));

      expect(row().getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(row());
      expect(current()?.value).toBe("");
    });
  });
});
