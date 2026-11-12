// 기준: Figma S05-E 모달(18:4175: 3단계 안내 · [채팅으로 면접 보기] · [다시 확인하기])
// · 모션 메모 S05-E(18:4221: 안내가 차례로 강조되는 3단계 루프, [다시 확인하기] → 버튼 안 스피너) · 기획 메모 S05-E(18:3468)
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionModal } from "./permission-modal";

// 경계 mock: 연출(motion). 동작 줄이기 여부만 대역으로 정하고, 등장 · 퇴장 연출은 건너뛴다
const reduce = vi.hoisted(() => vi.fn());
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: reduce,
  AnimatePresence: ({ children }: { children?: ReactNode }) => children,
}));

beforeEach(() => {
  reduce.mockReturnValue(true);
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(() => {
  MotionGlobalConfig.skipAnimations = false;
});

const props = {
  open: true,
  rechecking: false,
  onRecheck: vi.fn(),
  switchingToChat: false,
  onChat: vi.fn(),
};

const recheckButton = () => screen.getByRole("button", { name: "다시 확인하기" });
const chatButton = () => screen.getByRole("button", { name: "채팅으로 면접 보기" });

describe("PermissionModal · S05-E 권한 안내", () => {
  describe("화면 표시", () => {
    it("닫혀 있으면 그리지 않는다", () => {
      render(<PermissionModal {...props} open={false} />);

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("채팅 면접으로 바꾸지 못한 문구가 있으면 모달 안에 보여 준다", () => {
      render(<PermissionModal {...props} error="이미 처리된 요청이에요." />);

      expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(
        "이미 처리된 요청이에요.",
      );
    });

    it("다시 확인하는 동안 [다시 확인하기]는 바쁨 표시가 되고 두 버튼 모두 누를 수 없다", () => {
      render(<PermissionModal {...props} rechecking />);

      expect(recheckButton().getAttribute("aria-busy")).toBe("true");
      expect(recheckButton().hasAttribute("disabled")).toBe(true);
      expect(chatButton().hasAttribute("disabled")).toBe(true);
    });

    it("채팅으로 바꾸는 동안 [채팅으로 면접 보기]는 바쁨 표시가 되고 두 버튼 모두 누를 수 없다", () => {
      render(<PermissionModal {...props} switchingToChat />);

      expect(chatButton().getAttribute("aria-busy")).toBe("true");
      expect(chatButton().hasAttribute("disabled")).toBe(true);
      expect(recheckButton().hasAttribute("disabled")).toBe(true);
    });
  });

  describe("사용자 조작", () => {
    it("마지막 버튼에서 Tab을 누르면 첫 버튼으로 간다", () => {
      render(<PermissionModal {...props} />);
      recheckButton().focus();

      fireEvent.keyDown(recheckButton(), { key: "Tab" });

      expect(document.activeElement).toBe(chatButton());
    });
  });

  describe("정리", () => {
    it("열려 있는 동안 뒤 페이지 스크롤을 막고 닫히면 되돌린다", () => {
      const { rerender } = render(<PermissionModal {...props} />);
      expect(document.documentElement.style.overflow).toBe("hidden");

      rerender(<PermissionModal {...props} open={false} />);

      expect(document.documentElement.style.overflow).toBe("");
    });
  });
});
