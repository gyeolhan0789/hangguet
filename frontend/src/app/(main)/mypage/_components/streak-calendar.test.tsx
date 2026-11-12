// 기준: Figma S09 Streak Calendar(18:2930) · 웹 Swagger 3.3 연습 달력(practiceDate) · 3.2 통계(currentStreak)
// · 기획 메모 S09(18:1173: 날짜 → 그날의 연습 기록) · 모션 메모 S09(18:3109: 오늘은 링 펄스)
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StreakCalendar } from "./streak-calendar";

// 경계 mock: 동작 줄이기 여부는 테스트가 정하고, 달 전환(AnimatePresence)은 연출 없이 바로 바꾼다
const motion = vi.hoisted(() => ({ reduce: true }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
  useReducedMotion: () => motion.reduce,
}));

// 예시 데이터: Swagger 3.3 practiceDate 모양(그달 연습한 날) · 오늘 2026-10-15
const PRACTICED = ["2026-10-05", "2026-10-06", "2026-10-12"];

function renderCalendar() {
  return render(
    <StreakCalendar
      month="2026-10"
      practicedDates={PRACTICED}
      today="2026-10-15"
      currentStreak={7}
    />,
  );
}

beforeEach(() => {
  motion.reduce = true;
});

describe("StreakCalendar · 스트릭 달력", () => {
  describe("화면 표시", () => {
    it("이전 달 · 다음 달 링크는 앞뒤 달 마이페이지 주소로 간다", () => {
      renderCalendar();

      expect(screen.getByRole("link", { name: "이전 달" }).getAttribute("href")).toBe(
        "/mypage?month=2026-09",
      );
      expect(screen.getByRole("link", { name: "다음 달" }).getAttribute("href")).toBe(
        "/mypage?month=2026-11",
      );
    });

    it("지난날 · 오늘은 그날의 연습 기록으로 가는 링크다", () => {
      renderCalendar();

      expect(screen.getByRole("link", { name: "10월 4일" }).getAttribute("href")).toBe(
        "/records?date=2026-10-04",
      );
      expect(screen.getByRole("link", { name: "10월 15일 오늘" }).getAttribute("href")).toBe(
        "/records?date=2026-10-15",
      );
    });

    it("앞날은 누를 수 없다", () => {
      renderCalendar();

      expect(screen.queryByRole("link", { name: /^10월 16일/ })).toBeNull();
      expect(screen.getByText("16")).toBeDefined();
    });

    it("같은 주에서 이어 연습한 이틀 사이에 띠를 그린다", () => {
      renderCalendar();

      expect(screen.getAllByTestId("streak-band")).toHaveLength(2);
    });

    it("동작 줄이기면 오늘 링 펄스를 그리지 않는다", () => {
      renderCalendar();

      expect(screen.queryByTestId("today-pulse")).toBeNull();
    });

    it("동작 줄이기가 아니면 오늘 링 펄스를 그린다", () => {
      motion.reduce = false;

      renderCalendar();

      expect(screen.getByTestId("today-pulse")).toBeDefined();
    });
  });
});
