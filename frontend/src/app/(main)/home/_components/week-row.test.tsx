// 기준: Figma S02 Week · 모션 메모 'S02 스트릭 파도'(월 → … → 오늘 순서로 점이 하나씩 튀고, 빠진 날은 건너뛰고,
// 첫 방문(S02-D)은 점 없이 '오늘' 링만 숨쉰다)
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WeekDay } from "@/lib/home/week";

import { WeekRow } from "./week-row";

// 경계 mock: 연출(motion). 동작 줄이기 여부는 테스트가 정하고, 움직임(useAnimate의 animate)은 무엇을 움직이는지 · 멈췄는지만 본다
const motionState = vi.hoisted(() => {
  const stop = vi.fn();
  return {
    reduce: false,
    stop,
    animate: vi.fn<(...args: unknown[]) => { stop: () => void }>(() => ({ stop })),
  };
});
vi.mock("motion/react", async (importOriginal) => {
  const { useRef } = await import("react");
  return {
    ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
    useReducedMotion: () => motionState.reduce,
    useAnimate: () => [useRef(null), motionState.animate],
  };
});

// 예시 데이터: Swagger 3.1 예시 '끊김'의 이번 주(오늘 2026-10-15, 연습 10-10 · 10-11 · 10-12)
const WEEK: WeekDay[] = [
  { date: "2026-10-09", label: "금", status: "missed" },
  { date: "2026-10-10", label: "토", status: "done" },
  { date: "2026-10-11", label: "일", status: "done" },
  { date: "2026-10-12", label: "월", status: "done" },
  { date: "2026-10-13", label: "화", status: "missed" },
  { date: "2026-10-14", label: "수", status: "missed" },
  { date: "2026-10-15", label: "오늘", status: "today" },
];

/** 파도 시퀀스에서 튀기는 점 선택자 */
function wavedDots() {
  const sequence = motionState.animate.mock.calls[0][0] as [string][];
  return sequence.map(([selector]) => selector).filter((selector) => selector.includes("data-dot"));
}

beforeEach(() => {
  motionState.reduce = false;
});

describe("WeekRow · 홈 이번 주 7칸", () => {
  describe("상태 변화", () => {
    it("파도는 빠진 날을 건너뛰고 나머지 칸을 차례로 튀긴다", () => {
      render(<WeekRow days={WEEK} />);

      expect(wavedDots()).toEqual([
        '[data-dot="1"]',
        '[data-dot="2"]',
        '[data-dot="3"]',
        '[data-dot="6"]',
      ]);
    });

    it("파도를 끄면(wave=false) 오늘 링만 숨쉬게 한다", () => {
      render(<WeekRow days={WEEK} wave={false} />);

      expect(motionState.animate).toHaveBeenCalledTimes(1);
      expect(motionState.animate.mock.calls[0][0]).toBe('[data-ring="today"]');
    });

    it("동작 줄이기면 움직이지 않는다", () => {
      motionState.reduce = true;

      render(<WeekRow days={WEEK} />);

      expect(motionState.animate).not.toHaveBeenCalled();
    });
  });

  describe("정리", () => {
    it("화면을 벗어나면 움직임을 멈춘다", () => {
      const { unmount } = render(<WeekRow days={WEEK} />);

      unmount();

      expect(motionState.stop).toHaveBeenCalledTimes(1);
    });

    it("파도를 끈 채로 화면을 벗어나면 숨쉬기를 멈춘다", () => {
      const { unmount } = render(<WeekRow days={WEEK} wave={false} />);

      unmount();

      expect(motionState.stop).toHaveBeenCalledTimes(1);
    });
  });
});
