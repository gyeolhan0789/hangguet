import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReminderCard } from "./reminder-card";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 기준: 기획 메모 S09-1(18:1251: 연습 알림 메일은 MVP 제외 → 토글 · 시간 비활성) · 모션 메모 S09-1(18:3261: 토글 클릭 시 흔들림
// + 툴팁 '곧 열려요!' (상태 변경 X)). 툴팁이 떠 있는 시간(1.5초)은 가짜 시계로 본다.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("S09-1 연습 알림 메일(추가 예정)", () => {
  it("토글을 눌러도 꺼진 채로 툴팁 '곧 열려요!'만 1.5초 동안 뜬다", () => {
    render(<ReminderCard />);
    const toggle = screen.getByRole("switch", { name: "연습 알림 메일" });

    fireEvent.click(toggle);
    expect(screen.getByRole("status").textContent).toBe("곧 열려요!");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    act(() => vi.advanceTimersByTime(1499));
    expect(screen.queryByRole("status")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
