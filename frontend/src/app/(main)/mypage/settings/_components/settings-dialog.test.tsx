// 기준: 설정 화면 안내 · 확인 모달 틀(Figma에 시안 없음 — 탈퇴 확인 모달 S06-E 18:4299과 같은 모양 · 동작: Esc · dim으로 닫힘, 안에서만 Tab)
// · WAI-ARIA APG Dialog (Modal)
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsDialog } from "./settings-dialog";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

function renderDialog({
  open = true,
  busy = false,
  onClose = vi.fn(),
}: { open?: boolean; busy?: boolean; onClose?: () => void } = {}) {
  const view = (next: { busy: boolean }) => (
    <SettingsDialog
      open={open}
      title="카카오 연결을 해제할까요?"
      busy={next.busy}
      onClose={onClose}
    >
      <button type="button" disabled={next.busy}>
        취소
      </button>
      <button type="button" disabled={next.busy}>
        해제하기
      </button>
    </SettingsDialog>
  );
  const result = render(view({ busy }));
  return {
    ...result,
    onClose,
    setBusy: (value: boolean) => result.rerender(view({ busy: value })),
  };
}

/** dim(모달 바깥 배경) */
const dim = () => screen.getByRole("dialog").parentElement!;

describe("SettingsDialog · 설정 안내 · 확인 모달", () => {
  describe("화면 표시", () => {
    it("닫혀 있으면 그리지 않는다", () => {
      renderDialog({ open: false });

      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("사용자 조작", () => {
    it("Esc를 누르면 닫기를 요청한다", () => {
      const { onClose } = renderDialog();

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("dim을 누르면 닫기를 요청한다", () => {
      const { onClose } = renderDialog();

      fireEvent.mouseDown(dim());

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("모달 안을 누르면 닫기를 요청하지 않는다", () => {
      const { onClose } = renderDialog();

      fireEvent.mouseDown(screen.getByRole("dialog"));

      expect(onClose).not.toHaveBeenCalled();
    });

    it("Tab은 모달 안 버튼에서만 돈다", () => {
      renderDialog();
      screen.getByRole("button", { name: "해제하기" }).focus();

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "취소" }));
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("처리 중이면 Esc · dim으로 닫기를 요청하지 않는다", () => {
      const { onClose } = renderDialog({ busy: true });

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      fireEvent.mouseDown(dim());

      expect(onClose).not.toHaveBeenCalled();
    });

    it("처리 중이 되면 포커스를 모달로 옮긴다", () => {
      const { setBusy } = renderDialog();
      screen.getByRole("button", { name: "해제하기" }).focus();

      setBusy(true);

      expect(document.activeElement).toBe(screen.getByRole("dialog"));
    });

    it("처리 중이라 켜진 버튼이 없으면 Tab으로 모달 밖에 나가지 않는다", () => {
      renderDialog({ busy: true });

      const notPrevented = fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });

      expect(notPrevented).toBe(false);
    });
  });
});
