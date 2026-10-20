import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonaList } from "./persona-list";

// 연출 시간을 기다리지 않도록 '동작 줄이기' 상태로 그린다(토스트도 나가는 애니메이션 없이 사라진다).
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 기준: 모션 메모 S04 "'준비 중' 줄 클릭 시 살짝 흔들림 + 토스트 '곧 만나요!'" · 기획 메모 S04(마지막 줄은 선택 불가)
// 토스트가 보이는 시간(2초)은 화면 연출이라 E2E가 아니라 여기서 가짜 시계로 본다.
const comingSoon = () => screen.getByRole("button", { name: /또 다른 면접관을 만들고 있어요/ });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PersonaList '준비 중' 줄", () => {
  it("누르면 '곧 만나요!'를 2초 동안 알리고, 면접관은 고르지 않는다", () => {
    const onSelect = vi.fn();
    render(<PersonaList selected={null} onSelect={onSelect} />);

    fireEvent.click(comingSoon());
    expect(screen.getByRole("status").textContent).toBe("곧 만나요!");

    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByRole("status").textContent).toBe("곧 만나요!");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status").textContent).toBe("");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("떠 있는 동안 다시 누르면 2초를 처음부터 다시 센다", () => {
    render(<PersonaList selected={null} onSelect={vi.fn()} />);

    fireEvent.click(comingSoon());
    act(() => vi.advanceTimersByTime(1500));
    fireEvent.click(comingSoon());
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByRole("status").textContent).toBe("곧 만나요!");

    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
