// 기준: Figma 연습 기록 초안 Day · Calendar Card(232:843) · 웹 Swagger 5.15(날짜별 연습 면접 수) · 5.13 page.totalElements
// · 웹 Swagger 7.1(성장 리뷰 경로 값은 면접 시작 날짜)
// · 사용자 결정(2026-10-23: 달을 넘기면 같은 '일' · 말일 · 미래면 오늘, 다음 달이 미래면 못 넘김)
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DayCalendarCard } from "./day-calendar-card";

// 경계 mock: 연출(motion, 달 넘기기 스프링)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: 고른 날 2026-10-21 · 오늘 2026-10-23 · 연습한 날 10-20 · 10-21(웹 목 서버 5.15 2026-10 응답)
const renderCard = () =>
  render(
    <DayCalendarCard
      date="2026-10-21"
      today="2026-10-23"
      interviewCount={2}
      practicedDates={["2026-10-20", "2026-10-21"]}
    />,
  );

const grid = () => screen.getByRole("grid", { name: "2026년 10월 연습 달력" });

describe("DayCalendarCard · 고른 날과 연습 달력", () => {
  describe("고른 날", () => {
    describe("화면 표시", () => {
      it("고른 날을 'M월 D일'로, 그날 면접 수와 그날 성장 리뷰로 가는 링크를 보여 준다", () => {
        renderCard();

        expect(screen.getByRole("heading", { level: 2, name: "10월 21일" })).toBeDefined();
        expect(screen.getByText("면접 2회")).toBeDefined();
        expect(screen.getByRole("link", { name: "이날 성장 리뷰 보기" }).getAttribute("href")).toBe(
          "/reviews/2026-10-21",
        );
      });
    });
  });

  describe("달 넘기기", () => {
    describe("화면 표시", () => {
      it("[이전 달]은 같은 '일'을 고른 연습 기록으로 간다", () => {
        renderCard();

        expect(screen.getByRole("link", { name: "이전 달" }).getAttribute("href")).toBe(
          "/records?date=2026-09-21",
        );
      });
    });

    describe("경계값", () => {
      it("오늘이 든 달이면 [다음 달]을 누를 수 없다", () => {
        renderCard();

        expect(screen.queryByRole("link", { name: "다음 달" })).toBeNull();
      });
    });
  });

  describe("날짜 칸", () => {
    describe("화면 표시", () => {
      it("오늘까지의 날은 그날 연습 기록으로 가는 링크로, 앞날은 누를 수 없는 글자로 그린다", () => {
        renderCard();

        expect(within(grid()).getByRole("link", { name: "10월 1일" }).getAttribute("href")).toBe(
          "/records?date=2026-10-01",
        );
        expect(within(grid()).queryByRole("link", { name: /10월 24일/ })).toBeNull();
        expect(within(grid()).getByText("24")).toBeDefined();
      });
    });
  });
});
