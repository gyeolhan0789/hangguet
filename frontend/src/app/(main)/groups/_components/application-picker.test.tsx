// 기준: Figma [초안] G02 · G03 '내 지원서'('변경') · 사용자 결정(2026-11-13: [변경]은 모달, 목록은 S03 지원서 선택 UI)
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApplicationListItem } from "@/types/api";

import { ApplicationPicker } from "./application-picker";

// 경계 mock: 연출(motion)
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 4.3 지원서 목록(12 가온페이 · 15 ○○전자)
const APPLICATIONS = [
  {
    id: 12,
    companyName: "가온페이",
    jobTitle: "백엔드 개발자",
    createdAt: "2026-10-01T10:00:00+09:00",
  },
  {
    id: 15,
    companyName: "○○전자",
    jobTitle: "데이터 엔지니어",
    createdAt: "2026-10-02T10:00:00+09:00",
  },
] satisfies ApplicationListItem[];

function renderPicker(onChange = vi.fn()) {
  render(<ApplicationPicker applications={APPLICATIONS} value={12} onChange={onChange} />);
  return onChange;
}
const openPicker = () => fireEvent.click(screen.getByRole("button", { name: /^내 지원서/ }));

describe("ApplicationPicker · 그룹 지원서 고르기", () => {
  describe("지원서 고르기", () => {
    describe("화면 표시", () => {
      it("고른 지원서를 '회사 · 직무 (내 지원서)'로 보인다", () => {
        renderPicker();

        expect(screen.getByText("가온페이 · 백엔드 개발자 (내 지원서)")).toBeDefined();
      });
    });

    describe("상태 변화", () => {
      it("모달을 열면 지금 고른 지원서에 포커스를 둔다", () => {
        renderPicker();

        openPicker();

        expect(document.activeElement).toBe(
          screen.getByRole("radio", { name: /가온페이 · 백엔드 개발자/ }),
        );
      });

      it("모달을 닫으면 [변경] 칸으로 포커스를 돌려준다", () => {
        renderPicker();
        openPicker();

        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        expect(document.activeElement).toBe(screen.getByRole("button", { name: /^내 지원서/ }));
      });
    });

    describe("사용자 조작", () => {
      it("모달에서 다른 지원서를 고르고 [선택]을 누르면 그 지원서로 바꾸고 닫는다", () => {
        const onChange = renderPicker();
        openPicker();

        fireEvent.click(screen.getByRole("radio", { name: /○○전자 · 데이터 엔지니어/ }));
        fireEvent.click(screen.getByRole("button", { name: "선택" }));

        expect(onChange).toHaveBeenCalledWith(15);
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      it("모달에서 고르고 [취소]를 누르면 바꾸지 않고 닫는다", () => {
        const onChange = renderPicker();
        openPicker();

        fireEvent.click(screen.getByRole("radio", { name: /○○전자 · 데이터 엔지니어/ }));
        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    });
  });
});
