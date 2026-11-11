import { afterEach, describe, expect, it, vi } from "vitest";

import { cycleTabFocus } from "./cycle-tab-focus";

afterEach(() => {
  document.body.innerHTML = "";
});

function setup() {
  document.body.innerHTML = `
    <div id="dialog" tabindex="-1">
      <button id="first">첫째</button>
      <button id="middle">가운데</button>
      <button id="last">마지막</button>
    </div>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    dialog: get("dialog"),
    items: [get("first"), get("middle"), get("last")],
    get,
  };
}

const tab = (shiftKey = false) => ({ shiftKey, preventDefault: vi.fn() });

describe("cycleTabFocus (모달 초점 가두기)", () => {
  it("마지막 요소에서 Tab을 누르면 처음 요소로 간다", () => {
    const { items, get } = setup();
    get("last").focus();
    const event = tab();
    cycleTabFocus(event, items);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(get("first"));
  });

  it("처음 요소에서 Shift+Tab을 누르면 마지막 요소로 간다", () => {
    const { items, get } = setup();
    get("first").focus();
    const event = tab(true);
    cycleTabFocus(event, items);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(get("last"));
  });

  it("가운데에서는 브라우저 기본 이동을 막지 않는다", () => {
    const { items, get } = setup();
    get("middle").focus();
    const forward = tab();
    const backward = tab(true);
    cycleTabFocus(forward, items);
    cycleTabFocus(backward, items);
    expect(forward.preventDefault).not.toHaveBeenCalled();
    expect(backward.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(get("middle"));
  });

  it("대화상자 자신에 초점이 있으면 Shift+Tab은 마지막 요소로 가고, container를 주지 않으면 그대로 둔다", () => {
    const { dialog, items, get } = setup();
    dialog.focus();
    cycleTabFocus(tab(true), items);
    expect(document.activeElement).toBe(dialog);

    const event = tab(true);
    cycleTabFocus(event, items, dialog);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(get("last"));
  });

  it("초점 받을 요소가 없으면 아무것도 하지 않는다", () => {
    document.body.innerHTML = `<div id="dialog" tabindex="-1"></div>`;
    const dialog = document.getElementById("dialog") as HTMLElement;
    dialog.focus();
    const forward = tab();
    const backward = tab(true);
    cycleTabFocus(forward, []);
    cycleTabFocus(backward, [], dialog);
    expect(forward.preventDefault).not.toHaveBeenCalled();
    expect(backward.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dialog);
  });
});
