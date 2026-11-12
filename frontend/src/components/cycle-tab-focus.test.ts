// 기준: WAI-ARIA APG Dialog (Modal) 초점 가두기 · Figma S05-E(18:4013) 권한 안내 모달
import { afterEach, describe, expect, it, vi } from "vitest";

import { cycleTabFocus } from "./cycle-tab-focus";

afterEach(() => {
  document.body.innerHTML = "";
});

/** 대화상자 안에 버튼 셋(처음 · 가운데 · 마지막)을 붙인다 */
function dialogWithButtons() {
  const dialog = document.createElement("div");
  dialog.tabIndex = -1;
  const items = ["처음", "가운데", "마지막"].map((name) => {
    const button = document.createElement("button");
    button.textContent = name;
    dialog.append(button);
    return button;
  });
  document.body.append(dialog);
  const [first, middle, last] = items;
  return { dialog, items, first, middle, last };
}

const tabKey = (shiftKey = false) => ({ shiftKey, preventDefault: vi.fn() });

describe("cycleTabFocus · 모달 초점 가두기", () => {
  describe("사용자 조작", () => {
    it("마지막 요소에서 Tab을 누르면 처음 요소로 간다", () => {
      const { items, first, last } = dialogWithButtons();
      last.focus();
      const event = tabKey();

      cycleTabFocus(event, items);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(first);
    });

    it("처음 요소에서 Shift+Tab을 누르면 마지막 요소로 간다", () => {
      const { items, first, last } = dialogWithButtons();
      first.focus();
      const event = tabKey(true);

      cycleTabFocus(event, items);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(last);
    });

    it("대화상자 자신에서 Shift+Tab을 누르면 마지막 요소로 간다", () => {
      const { dialog, items, last } = dialogWithButtons();
      dialog.focus();
      const event = tabKey(true);

      cycleTabFocus(event, items, dialog);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(last);
    });

    it("가운데 요소에서는 브라우저 기본 이동을 막지 않는다", () => {
      const { dialog, items, middle } = dialogWithButtons();
      middle.focus();
      const forward = tabKey();
      const backward = tabKey(true);

      cycleTabFocus(forward, items, dialog);
      cycleTabFocus(backward, items, dialog);

      expect(forward.preventDefault).not.toHaveBeenCalled();
      expect(backward.preventDefault).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(middle);
    });
  });

  describe("경계값", () => {
    it("초점 받을 요소가 없으면 아무것도 하지 않는다", () => {
      const { dialog } = dialogWithButtons();
      dialog.focus();
      const event = tabKey(true);

      cycleTabFocus(event, [], dialog);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(dialog);
    });

    it("대화상자를 주지 않았으면 대화상자 자신에서의 Shift+Tab은 막지 않는다", () => {
      const { dialog, items } = dialogWithButtons();
      dialog.focus();
      const event = tabKey(true);

      cycleTabFocus(event, items);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(dialog);
    });
  });
});
