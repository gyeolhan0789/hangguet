// 기준: Figma S09-1 Row 닉네임(18:3157) · Swagger 2.2 닉네임 변경(NicknameRequest 최대 50자) · 기획 메모 S09-1
// · 모션 메모 S09-1(18:3261: 행에서 인라인 편집) · 사용자 결정 2026-11-05(다른 화면에 갔다 오면 편집칸을 접는다)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { describe, expect, it, vi } from "vitest";

import { changeNickname } from "@/lib/user/actions";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { NicknameRow } from "./nickname-row";

// 경계 mock: 서버 액션(2.2)과 연출(motion)
vi.mock("@/lib/user/actions", () => ({ changeNickname: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 2.1 nickname 예시
const NICKNAME = "면접왕";

const row = () => screen.getByRole("button", { name: /닉네임/ });
const input = () => screen.queryByRole<HTMLInputElement>("textbox", { name: "닉네임" });
const typeNickname = (value: string) => fireEvent.change(input()!, { target: { value } });

/** 줄을 눌러 편집칸을 연다 */
function renderEditing() {
  render(<NicknameRow nickname={NICKNAME} />);
  fireEvent.click(row());
}

describe("NicknameRow · 설정 닉네임 줄", () => {
  describe("사용자 조작", () => {
    it("줄을 누르면 지금 닉네임이 든 편집칸을 연다", () => {
      renderEditing();

      expect(input()?.value).toBe(NICKNAME);
    });

    it("[취소]를 누르면 편집칸을 닫는다", () => {
      renderEditing();

      fireEvent.click(screen.getByRole("button", { name: "취소" }));

      expect(input()).toBeNull();
    });

    it("Esc를 누르면 편집칸을 닫는다", () => {
      renderEditing();

      fireEvent.keyDown(input()!, { key: "Escape" });

      expect(input()).toBeNull();
    });

    it("고치다 닫고 다시 열면 지금 닉네임부터 시작한다", () => {
      renderEditing();
      typeNickname("새 닉네임");
      fireEvent.click(screen.getByRole("button", { name: "취소" }));

      fireEvent.click(row());

      expect(input()?.value).toBe(NICKNAME);
    });
    it("저장되면 편집칸을 닫는다", async () => {
      vi.mocked(changeNickname).mockResolvedValue({ ok: true });
      renderEditing();
      typeNickname("새 닉네임");

      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await flushPromises();

      expect(changeNickname).toHaveBeenCalledTimes(1);
      expect(input()).toBeNull();
    });
  });

  describe("입력 검증", () => {
    it("공백뿐이면 보내지 않고 칸 아래에 문구를 보여 준다", async () => {
      renderEditing();
      typeNickname("   ");

      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await flushPromises();

      expect(changeNickname).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toBe("필수 값입니다.");
    });
  });

  describe("오류 처리", () => {
    it("서버가 폼 오류를 주면 칸 아래에 문구를 보여 준다", async () => {
      vi.mocked(changeNickname).mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
      renderEditing();
      typeNickname("새 닉네임");

      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await flushPromises();

      expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요.");
      expect(input()).not.toBeNull();
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("저장하는 동안에는 [저장] · [취소]를 누를 수 없다", async () => {
      const saving = deferred<{ ok: true }>();
      vi.mocked(changeNickname).mockReturnValue(saving.promise);
      renderEditing();
      typeNickname("새 닉네임");

      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await flushPromises();

      expect(screen.getByRole("button", { name: "저장" }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true);
      await act(async () => saving.resolve({ ok: true }));
    });
  });

  describe("정리", () => {
    it("화면이 숨겨지면 편집칸을 접는다", () => {
      const view = (mode: "visible" | "hidden") => (
        <Activity mode={mode}>
          <NicknameRow nickname={NICKNAME} />
        </Activity>
      );
      const { rerender } = render(view("visible"));
      fireEvent.click(row());

      rerender(view("hidden"));
      rerender(view("visible"));

      expect(input()).toBeNull();
    });
  });
});
