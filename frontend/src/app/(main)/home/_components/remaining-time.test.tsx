// 기준: Figma S02 '오늘 남은 시간' 칩 · 한국 시간 자정까지 남은 시간을 1초마다 갱신
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { spyTimers } from "@/test/timers";

import { RemainingTime } from "./remaining-time";

// 경계 mock: 현재 시각과 1초 갱신 타이머를 가짜 타이머로 고정한다(한국 시간 2026-10-15 23:00)
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T23:00:00+09:00"));
});

describe("RemainingTime · 자정까지 남은 시간", () => {
  describe("화면 표시", () => {
    it("한국 시간 자정까지 남은 시간을 보여 준다", () => {
      render(<RemainingTime />);

      expect(screen.getByText("01:00:00")).toBeDefined();
    });
  });

  describe("시간 경과", () => {
    it("1초가 지나면 남은 시간을 다시 그린다", () => {
      render(<RemainingTime />);

      act(() => vi.advanceTimersByTime(1000));

      expect(screen.getByText("00:59:59")).toBeDefined();
    });
  });

  describe("정리", () => {
    it("화면을 벗어나면 1초 갱신을 멈춘다", () => {
      const timers = spyTimers();
      const { unmount } = render(<RemainingTime />);

      unmount();

      expect(timers.cleared("interval", 1000)).toBe(true);
    });
  });
});
