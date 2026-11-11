import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DayCalendarCard } from "./day-calendar-card";

// 연출(달 넘기기 스프링)은 기다리지 않도록 '동작 줄이기'로 그린다.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 기준: Figma 연습 기록 초안 Day · Calendar Card(232:843: '10월 21일' · '면접 2회' · [이날 성장 리뷰 보기 ›] · 연습 달력
// · 요일 brand · 연습한 날 스트릭 띠 · 오늘 테두리 원) · 웹 Swagger 5.15 월별 연습 면접 횟수(interviewCount > 0인 날이 연습한 날) · 5.13
// · 날짜를 고르면 그날 목록, 미래 날짜는 선택하지 않음, 성장 리뷰는 /reviews/{date}(웹 Swagger 7.1 경로 값은 면접 시작 날짜)
// · 사용자 결정(2026-10-23: 달을 넘기면 같은 '일' · 말일 · 미래면 오늘, 다음 달이 미래면 못 넘김)

afterEach(() => cleanup());

const grid = () => screen.getByRole("grid", { name: /연습 달력/ });

function view(props: Partial<Parameters<typeof DayCalendarCard>[0]> = {}) {
  return render(
    <DayCalendarCard
      date="2026-10-21"
      today="2026-10-23"
      interviewCount={2}
      practicedDates={["2026-10-20", "2026-10-21"]}
      {...props}
    />,
  );
}

describe("DayCalendarCard · 고른 날", () => {
  it("고른 날 · 그날 면접 수를 보여 주고, [이날 성장 리뷰 보기]는 그날의 S08로 간다", () => {
    view();

    expect(screen.getByRole("heading", { level: 2, name: "10월 21일" })).toBeTruthy();
    expect(screen.getByText("면접 2회")).toBeTruthy();
    expect(screen.getByRole("link", { name: "이날 성장 리뷰 보기" }).getAttribute("href")).toBe(
      "/reviews/2026-10-21",
    );
  });
});

describe("DayCalendarCard · 연습 달력", () => {
  it("요일 7개와 그달 날짜 31개를 그리고, 달 이름을 보여 준다", () => {
    view();

    expect(
      within(grid())
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["일", "월", "화", "수", "목", "금", "토"]);
    expect(screen.getByText("2026년 10월")).toBeTruthy();
    expect(
      within(grid())
        .getAllByRole("gridcell")
        .filter((c) => c.textContent),
    ).toHaveLength(31);
  });

  it("오늘까지의 날은 그날을 고른 연습 기록으로 가고, 앞날은 누를 수 없다", () => {
    view();

    expect(within(grid()).getByRole("link", { name: "10월 1일" }).getAttribute("href")).toBe(
      "/records?date=2026-10-01",
    );
    expect(within(grid()).getByRole("link", { name: "10월 23일 오늘" }).getAttribute("href")).toBe(
      "/records?date=2026-10-23",
    );
    expect(within(grid()).queryByRole("link", { name: /10월 24일/ })).toBeNull();
    expect(within(grid()).getByText("24")).toBeTruthy();
  });

  it("연습한 날(5.15 interviewCount > 0)은 이름에 '연습함'을 붙이고 스트릭 띠로 잇는다", () => {
    view();

    expect(within(grid()).getByRole("link", { name: "10월 20일 연습함" })).toBeTruthy();
    expect(within(grid()).getByRole("link", { name: "10월 21일 연습함" })).toBeTruthy();
    expect(screen.getAllByTestId("streak-band")).toHaveLength(2);
  });

  it("고른 날만 aria-current=date다", () => {
    view();

    const current = within(grid())
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "date");
    expect(current.map((link) => link.getAttribute("aria-label"))).toEqual(["10월 21일 연습함"]);
  });

  it("‹ 이전 달은 같은 '일'로 가고, 오늘이 든 달이면 › 다음 달은 누를 수 없다", () => {
    view();

    expect(screen.getByRole("link", { name: "이전 달" }).getAttribute("href")).toBe(
      "/records?date=2026-09-21",
    );
    expect(screen.queryByRole("link", { name: "다음 달" })).toBeNull();
  });

  it("지난 달을 보고 있으면 › 다음 달로 갈 수 있고, 같은 '일'이 미래면 오늘로 간다", () => {
    view({ date: "2026-09-30", practicedDates: [] });

    expect(screen.getByRole("link", { name: "다음 달" }).getAttribute("href")).toBe(
      "/records?date=2026-10-23",
    );
  });
});
