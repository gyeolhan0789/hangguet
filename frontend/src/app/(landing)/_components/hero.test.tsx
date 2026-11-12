// 기준: Figma 랜딩 Hero 모션 메모(번개: 4~7초 랜덤 간격으로 번쩍) · 사용자 결정(2026-10-22: 동작 줄이기면 번개 없음)
import { render } from "@testing-library/react";
import { animate, useReducedMotion } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { spyTimers } from "@/test/timers";

import { Hero } from "./hero";

// 경계 mock: 번개 연출(animate — 언제 치는지가 우리 로직이라 호출만 본다) · 동작 줄이기 설정 · 화면에 보이는지
// (IntersectionObserver) · 난수(번개 간격) · 타이머
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  animate: vi.fn(),
  useReducedMotion: vi.fn(() => false),
}));

class StillIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", StillIntersectionObserver);
  vi.useFakeTimers();
  // 번개 간격(4~7초)을 5.5초로 고정한다
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

describe("Hero · 랜딩 첫 화면", () => {
  describe("시간 경과", () => {
    it("번개 뒤에는 난수로 정한 4~7초 뒤 다시 친다", () => {
      render(<Hero />);
      vi.advanceTimersByTime(2_000);
      // 번개 한 번에 번쩍임 · 배경 밝기 두 연출을 건다
      expect(animate).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(5_499);
      expect(animate).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(1);
      expect(animate).toHaveBeenCalledTimes(4);
    });

    it("동작 줄이기를 켜면 번개를 치지 않는다", () => {
      vi.mocked(useReducedMotion).mockReturnValue(true);
      render(<Hero />);

      vi.advanceTimersByTime(10_000);

      expect(animate).not.toHaveBeenCalled();
    });
  });

  describe("정리", () => {
    it("언마운트하면 다음 번개를 걸지 않는다", () => {
      const timers = spyTimers();
      const { unmount } = render(<Hero />);

      unmount();

      expect(timers.cleared("timeout", 2000)).toBe(true);
    });
  });
});
