// 기준: Figma S09 Stats(18:2891) · Swagger 3.2 통계(StatsResponse) · 모션 메모 S09(18:3109: 숫자 카운트업 0→값)
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StatsResponse } from "@/types/api";

import { StatTiles } from "./stat-tiles";

// 경계 mock: 동작 줄이기 여부는 테스트가 정하고, 숫자 세기(animate)는 값을 진행하지 않는 대역으로 바꾼다
const motion = vi.hoisted(() => {
  const stop = vi.fn();
  return { reduce: true, stop, animate: vi.fn(() => ({ stop })) };
});
vi.mock("motion/react", async (importOriginal) => ({
  ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
  useReducedMotion: () => motion.reduce,
  animate: motion.animate,
}));

// 예시 데이터: Swagger 3.2 200 예시
const STATS: StatsResponse = {
  currentStreak: 7,
  bestStreak: 14,
  totalInterviewCount: 23,
  totalPracticeMinutes: 400,
  latestJobTitle: "백엔드 개발자",
};

beforeEach(() => {
  motion.reduce = true;
});

describe("StatTiles · 통계 타일", () => {
  describe("화면 표시", () => {
    it("현재 · 최장 스트릭 · 총 면접 · 총 연습 시간을 각 이름과 단위 붙은 값으로 보여 준다", () => {
      render(<StatTiles stats={STATS} />);

      const tiles = screen.getAllByRole("listitem").map((tile) => tile.textContent);
      expect(tiles).toHaveLength(4);
      expect(tiles[0]).toContain("7일");
      expect(tiles[0]).toContain("현재 스트릭");
      expect(tiles[1]).toContain("14일");
      expect(tiles[1]).toContain("최장 스트릭");
      expect(tiles[2]).toContain("23회");
      expect(tiles[2]).toContain("총 면접");
      expect(tiles[3]).toContain("6시간 40분");
      expect(tiles[3]).toContain("총 연습 시간");
    });

    it("동작 줄이기면 세지 않고 최종 값을 바로 보여 준다", () => {
      render(<StatTiles stats={STATS} />);

      expect(motion.animate).not.toHaveBeenCalled();
      expect(screen.queryByText("0일")).toBeNull();
      expect(screen.getAllByText("23회")).toHaveLength(2);
    });

    it("동작 줄이기가 아니면 숫자를 세어 올린다", () => {
      motion.reduce = false;

      render(<StatTiles stats={STATS} />);

      expect(motion.animate).toHaveBeenCalledTimes(4);
      expect(screen.getAllByText("0일")).toHaveLength(2);
    });
  });

  describe("상태 변화", () => {
    it("동작 줄이기에서 값이 바뀌면 새 값을 바로 보여 준다", () => {
      const { rerender } = render(<StatTiles stats={STATS} />);

      rerender(<StatTiles stats={{ ...STATS, totalInterviewCount: 24 }} />);

      expect(screen.getAllByText("24회")).toHaveLength(2);
      expect(screen.queryByText("23회")).toBeNull();
    });
  });

  describe("정리", () => {
    it("언마운트하면 세기를 멈춘다", () => {
      motion.reduce = false;
      const { unmount } = render(<StatTiles stats={STATS} />);

      unmount();

      expect(motion.stop).toHaveBeenCalledTimes(4);
    });
  });
});
