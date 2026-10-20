import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toast, TOAST_MS } from "@/components/toast";

import { AchievementsCard, ApplicationCard } from "./coming-soon";

// 연출 시간을 기다리지 않도록 '동작 줄이기' 상태로 그린다(토스트도 나가는 애니메이션 없이 사라진다).
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 기준: 모션 메모 S09(18:3109: '추가 예정' 업적 · '개발 중' 지원 관리는 클릭 시 살짝 흔들림 + 토스트 '열심히 만들고 있어요!')
// 두 카드가 화면에 하나뿐인 토스트(zustand 저장소)를 나눠 쓰고, 2초 뒤 사라지는 것은 가짜 시계로 본다.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderCards() {
  render(
    <>
      <AchievementsCard />
      <ApplicationCard />
      <Toast />
    </>,
  );
}

describe("S09 준비 중 카드", () => {
  it("업적을 누르면 토스트가 2초 동안 뜨고 사라진다", () => {
    renderCards();

    fireEvent.click(screen.getByRole("button", { name: /업적/ }));
    expect(screen.getByRole("status").textContent).toBe("열심히 만들고 있어요!");

    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(screen.getByRole("status").textContent).toBe("열심히 만들고 있어요!");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("두 카드가 토스트 하나를 같이 쓴다: 떠 있는 동안 지원 관리를 누르면 2초를 처음부터 다시 센다", () => {
    renderCards();

    fireEvent.click(screen.getByRole("button", { name: /업적/ }));
    act(() => vi.advanceTimersByTime(1500));
    fireEvent.click(screen.getByRole("button", { name: /지원 관리/ }));
    act(() => vi.advanceTimersByTime(1500));

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("열심히 만들고 있어요!");
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
