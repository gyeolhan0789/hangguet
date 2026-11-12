// 기준: Figma C01 프로필 메뉴(18:3110: 아바타를 누르면 드롭다운, 바깥 클릭 · Esc로 닫힘 · 마이페이지 · 문의하기 · 로그아웃)
// · 사용자 결정(2026-10-29: 마이페이지 아래 지원 관리 줄) · Swagger 2.1 MeResponse
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MeResponse } from "@/types/api";

import { ProfileMenu } from "./profile-menu";

// 경계 mock: 서버 액션(로그아웃)과 연출(motion)
vi.mock("@/lib/auth/actions", () => ({ logout: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 2.1 200 예시
const USER: MeResponse = {
  id: 1,
  email: "example@ssafy.com",
  nickname: "면접왕",
  socialProvider: null,
  linkedProvider: null,
  profileImageUrl: null,
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
};

const avatar = () => screen.getByRole("button", { name: "프로필 메뉴" });
const menu = () => screen.queryByRole("menu");

/** 아바타를 눌러 메뉴를 펼친다 */
function renderOpen() {
  render(<ProfileMenu user={USER} />);
  fireEvent.click(avatar());
}

describe("ProfileMenu · 헤더 프로필 메뉴", () => {
  describe("사용자 조작", () => {
    it("아바타를 누르면 펼치고 다시 누르면 닫는다", () => {
      render(<ProfileMenu user={USER} />);

      fireEvent.click(avatar());
      expect(menu()).not.toBeNull();
      expect(avatar().getAttribute("aria-expanded")).toBe("true");

      fireEvent.click(avatar());
      expect(menu()).toBeNull();
      expect(avatar().getAttribute("aria-expanded")).toBe("false");
    });

    it("펼친 상태에서 Esc를 누르면 닫는다", () => {
      renderOpen();

      fireEvent.keyDown(document, { key: "Escape" });

      expect(menu()).toBeNull();
    });

    it("펼친 상태에서 바깥을 누르면 닫는다", () => {
      renderOpen();

      fireEvent.mouseDown(document.body);

      expect(menu()).toBeNull();
    });

    it("펼친 상태에서 메뉴 안을 누르면 그대로 둔다", () => {
      renderOpen();

      fireEvent.mouseDown(menu()!);

      expect(menu()).not.toBeNull();
    });

    it("펼친 상태에서 Esc가 아닌 키를 누르면 그대로 둔다", () => {
      renderOpen();

      fireEvent.keyDown(document, { key: "Enter" });

      expect(menu()).not.toBeNull();
    });

    it.each([{ label: "마이페이지" }, { label: "지원 관리" }, { label: "문의하기" }])(
      "'$label'을 누르면 메뉴를 닫는다",
      ({ label }) => {
        renderOpen();

        fireEvent.click(screen.getByRole("menuitem", { name: label }));

        expect(menu()).toBeNull();
      },
    );
  });

  describe("정리", () => {
    it("닫으면 바깥 클릭 · 키 감지를 해제한다", () => {
      render(<ProfileMenu user={USER} />);
      const add = vi.spyOn(document, "addEventListener");
      const remove = vi.spyOn(document, "removeEventListener");
      fireEvent.click(avatar());
      const onMouseDown = add.mock.calls.find(([type]) => type === "mousedown")?.[1];
      const onKeyDown = add.mock.calls.find(([type]) => type === "keydown")?.[1];

      fireEvent.click(avatar());

      expect(onMouseDown).toBeDefined();
      expect(remove).toHaveBeenCalledWith("mousedown", onMouseDown);
      expect(remove).toHaveBeenCalledWith("keydown", onKeyDown);
    });
  });
});
