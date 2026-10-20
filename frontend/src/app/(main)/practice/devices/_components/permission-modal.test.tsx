import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionModal, STEP_LOOP_MS } from "./permission-modal";

// 기준: Figma S05-E 모달(18:4175: 3단계 안내 · 주소창 예시 · [채팅으로 면접 보기] · [다시 확인하기])
// · 모션 메모 S05-E(18:4221: 안내가 차례로 하이라이트되는 3단계 루프, [다시 확인하기] → 버튼 안 스피너)
// · 모션 메모 S05-1(동작 줄이기면 루프 없이)
// 강조는 장식이라 역할 · 이름이 없어 data-highlighted로 본다. 모달이 뜨고 닫히는 흐름 · Tab 순환은 E2E가 맡는다.

let reduce = false;
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => reduce,
}));

const props = {
  open: true,
  rechecking: false,
  onRecheck: vi.fn(),
  switchingToChat: false,
  onChat: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  reduce = false;
});

const steps = () => within(screen.getByRole("dialog")).getAllByRole("listitem");
const highlighted = () => steps().findIndex((step) => step.hasAttribute("data-highlighted"));

describe("PermissionModal (S05-E 권한 안내)", () => {
  it("닫혀 있으면 그리지 않는다", () => {
    render(<PermissionModal {...props} open={false} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("안내 3단계를 1 → 2 → 3 → 1 차례로 강조하며 되풀이한다", () => {
    render(<PermissionModal {...props} />);
    expect(highlighted()).toBe(0);

    act(() => vi.advanceTimersByTime(STEP_LOOP_MS));
    expect(highlighted()).toBe(1);
    act(() => vi.advanceTimersByTime(STEP_LOOP_MS));
    expect(highlighted()).toBe(2);
    act(() => vi.advanceTimersByTime(STEP_LOOP_MS));
    expect(highlighted()).toBe(0);
  });

  it("동작 줄이기면 강조 루프 없이 멈춰 있다", () => {
    reduce = true;
    render(<PermissionModal {...props} />);

    act(() => vi.advanceTimersByTime(STEP_LOOP_MS * 3));

    expect(highlighted()).toBe(-1);
  });

  it("두 버튼은 각각 다시 확인 · 채팅 전환을 부른다", () => {
    render(<PermissionModal {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "다시 확인하기" }));
    fireEvent.click(screen.getByRole("button", { name: "채팅으로 면접 보기" }));

    expect(props.onRecheck).toHaveBeenCalledTimes(1);
    expect(props.onChat).toHaveBeenCalledTimes(1);
  });

  it("다시 확인하는 동안 그 버튼은 스피너와 함께 바쁨 표시가 되고, 두 버튼 모두 누를 수 없다", () => {
    render(<PermissionModal {...props} rechecking />);

    const recheck = screen.getByRole("button", { name: "다시 확인하기" });
    expect(recheck.getAttribute("aria-busy")).toBe("true");
    expect(recheck.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "채팅으로 면접 보기" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("채팅 면접으로 바꾸지 못하면 그 문구를 보여 준다", () => {
    render(<PermissionModal {...props} error="잠시 후 다시 시도해 주세요." />);

    expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요.");
  });
});
