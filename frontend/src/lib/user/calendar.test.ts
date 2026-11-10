import { describe, expect, it } from "vitest";

import {
  buildCalendar,
  formatMinutes,
  monthDirection,
  monthLabel,
  monthOf,
  parseMonth,
  shiftMonth,
  startedLabel,
  weekCells,
  type CalendarDay,
} from "./calendar";

// 기준: Figma S09 Streak Calendar(18:2930: 2026년 10월 — 1~3 · 6~12일 연습, 오늘 13일, 4 · 5일은 지난날, 14일부터 앞날)
// · 기획 메모 S09(연속 연습한 날은 띠로 이어 보여줌) · 연속일 띠는 날짜가 이어지는지로 화면이 그린다

const FIGMA_PRACTICED = new Set(
  ["01", "02", "03", "06", "07", "08", "09", "10", "11", "12"].map((d) => `2026-10-${d}`),
);

const dayOf = (weeks: ReturnType<typeof buildCalendar>, day: number) =>
  weeks.flat().find((cell): cell is CalendarDay => cell?.day === day)!;

describe("buildCalendar (스트릭 달력)", () => {
  const weeks = buildCalendar("2026-10", FIGMA_PRACTICED, "2026-10-13");

  it("일요일부터 7칸씩, 1일 앞 · 말일 뒤는 빈칸이다(2026년 10월 1일은 목요일)", () => {
    expect(weeks).toHaveLength(5);
    expect(weeks[0].map((cell) => cell?.day ?? null)).toEqual([null, null, null, null, 1, 2, 3]);
    expect(weeks[4].map((cell) => cell?.day ?? null)).toEqual([25, 26, 27, 28, 29, 30, 31]);
  });

  it("연속한 날은 같은 주 안에서만 띠로 잇는다(Figma: 3일 토요일 · 10일 토요일에서 끊김)", () => {
    expect(dayOf(weeks, 1)).toMatchObject({ joinPrev: false, joinNext: true });
    expect(dayOf(weeks, 2)).toMatchObject({ joinPrev: true, joinNext: true });
    expect(dayOf(weeks, 3)).toMatchObject({ joinPrev: true, joinNext: false });
    expect(dayOf(weeks, 6)).toMatchObject({ joinPrev: false, joinNext: true });
    expect(dayOf(weeks, 10)).toMatchObject({ joinPrev: true, joinNext: false });
    expect(dayOf(weeks, 11)).toMatchObject({ joinPrev: false, joinNext: true });
    expect(dayOf(weeks, 12)).toMatchObject({ joinPrev: true, joinNext: false });
  });

  it("연습 안 한 날은 띠가 없고, 오늘 전 · 오늘 · 오늘 뒤를 나눈다", () => {
    expect(dayOf(weeks, 4)).toMatchObject({
      practiced: false,
      joinPrev: false,
      joinNext: false,
      state: "past",
    });
    expect(dayOf(weeks, 13)).toMatchObject({ practiced: false, state: "today" });
    expect(dayOf(weeks, 14)).toMatchObject({ state: "future" });
  });

  it("일요일에 시작하는 4주짜리 달(2026년 2월): 1일이 첫 칸이고, 일요일 칸은 전날과 띠를 잇지 않는다", () => {
    const feb = buildCalendar(
      "2026-02",
      new Set(["2026-02-07", "2026-02-08", "2026-02-09"]),
      "2026-03-01",
    );
    expect(feb).toHaveLength(4);
    expect(feb[0][0]?.day).toBe(1);
    expect(dayOf(feb, 7)).toMatchObject({ joinPrev: false, joinNext: false });
    expect(dayOf(feb, 8)).toMatchObject({ joinPrev: false, joinNext: true });
    expect(feb.flat().every((cell) => cell?.state === "past")).toBe(true);
  });

  it("오늘 뒤의 달은 모두 앞날이다", () => {
    const future = buildCalendar("2026-11", new Set(), "2026-10-13");
    expect(future.flat().every((cell) => cell === null || cell.state === "future")).toBe(true);
  });

  it("6주가 필요한 달도 그린다(2026년 8월: 토요일 시작 · 31일)", () => {
    expect(buildCalendar("2026-08", new Set(), "2026-10-13")).toHaveLength(6);
  });

  it("2월 말일(윤년 29일)까지 그린다", () => {
    const days = buildCalendar("2028-02", new Set(), "2028-03-01").flat().filter(Boolean);
    expect(days).toHaveLength(29);
  });
});

describe("weekCells (칸 key)", () => {
  const weeks = buildCalendar("2026-10", FIGMA_PRACTICED, "2026-10-13");

  it("1일 앞 빈칸은 그 자리의 지난달 날짜, 그달 칸은 그 날짜다(2026년 10월 1일은 목요일)", () => {
    expect(weekCells(weeks[0])).toEqual([
      { date: "2026-09-27", day: null },
      { date: "2026-09-28", day: null },
      { date: "2026-09-29", day: null },
      { date: "2026-09-30", day: null },
      { date: "2026-10-01", day: dayOf(weeks, 1) },
      { date: "2026-10-02", day: dayOf(weeks, 2) },
      { date: "2026-10-03", day: dayOf(weeks, 3) },
    ]);
  });

  it("말일 뒤 빈칸은 그 자리의 다음 달 날짜다(2026년 11월 30일은 월요일)", () => {
    const nov = buildCalendar("2026-11", new Set(), "2026-10-13");
    expect(nov).toHaveLength(5);
    expect(weekCells(nov[4]).map((cell) => cell.date)).toEqual([
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
      "2026-12-05",
    ]);
  });

  it("달력 전체에서 칸 날짜가 겹치지 않는다", () => {
    const dates = buildCalendar("2026-08", new Set(), "2026-10-13").flatMap((week) =>
      weekCells(week).map((cell) => cell.date),
    );
    expect(new Set(dates).size).toBe(dates.length);
  });
});

describe("monthDirection (달 넘김 방향)", () => {
  it("이전 달로 가면 -1, 다음 달 · 같은 달이면 1이고, 해가 바뀌어도 맞다", () => {
    expect(monthDirection("2026-10", "2026-09")).toBe(-1);
    expect(monthDirection("2026-10", "2026-11")).toBe(1);
    expect(monthDirection("2026-01", "2025-12")).toBe(-1);
    expect(monthDirection("2025-12", "2026-01")).toBe(1);
    expect(monthDirection("2026-10", "2026-10")).toBe(1);
  });
});

describe("달 계산", () => {
  it.each([
    ["2026-10", "2026-10"],
    ["2026-13", null],
    ["2026-1", null],
    ["abc", null],
    [undefined, null],
    [["2026-10"], null],
  ] as const)("parseMonth(%j) → %j", (value, expected) => {
    expect(parseMonth(value as string | string[] | undefined)).toBe(expected);
  });

  it("앞뒤 달로 옮길 때 해가 바뀐다", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", -1)).toBe("2026-09");
  });

  it("YYYY-MM-DD의 달 · 'YYYY년 M월' 표기", () => {
    expect(monthOf("2026-10-13")).toBe("2026-10");
    expect(monthLabel("2026-09")).toBe("2026년 9월");
  });
});

describe("표기", () => {
  it("가입 일시는 한국 시간 기준 달로 '2026년 9월 시작'", () => {
    expect(startedLabel("2026-09-01T10:00:00+09:00")).toBe("2026년 9월 시작");
    // UTC로는 8월 31일이지만 한국 시간으로는 9월 1일
    expect(startedLabel("2026-08-31T16:00:00Z")).toBe("2026년 9월 시작");
  });

  it.each([
    [400, "6시간 40분"],
    [40, "40분"],
    [0, "0분"],
    [360, "6시간"],
  ])("연습 시간 %i분 → %s", (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected);
  });
});
