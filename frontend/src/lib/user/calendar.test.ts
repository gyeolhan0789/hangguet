// @vitest-environment node
// 기준: Figma S09 Streak Calendar(18:2930: 일~토 7칸 · 연속한 날은 띠로 이어짐(주가 바뀌면 끊김) · 지난날 · 오늘 · 앞날)
// · 기획 메모 S09(18:1173) · 웹 Swagger 3.3 연습 기록(month YYYY-MM · practiceDate YYYY-MM-DD)
import { describe, expect, it } from "vitest";

import {
  buildCalendar,
  formatMinutes,
  monthDirection,
  monthLabel,
  parseMonth,
  shiftMonth,
  startedLabel,
  type CalendarDay,
  type CalendarWeek,
} from "./calendar";

// 예시 데이터: Figma S09 Streak Calendar(2026년 10월 — 1~3 · 6~12일 연습, 오늘 13일)
const OCTOBER_PRACTICED = new Set(
  ["01", "02", "03", "06", "07", "08", "09", "10", "11", "12"].map((day) => `2026-10-${day}`),
);

const dayOf = (weeks: CalendarWeek[], day: number) =>
  weeks.flat().find((cell): cell is CalendarDay => cell?.day === day);
const daysOf = (week: CalendarWeek) => week.map((cell) => cell?.day ?? null);

describe("parseMonth · 주소의 달 읽기", () => {
  describe("정상 처리", () => {
    it("'YYYY-MM'이면 그 값을 돌려준다", () => {
      expect(parseMonth("2026-10")).toBe("2026-10");
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "undefined", value: undefined },
      { label: "배열", value: ["2026-10"] },
      { label: "2026-13", value: "2026-13" },
      { label: "2026-00", value: "2026-00" },
      { label: "2026-1", value: "2026-1" },
    ])("달이 '$label'이면 null을 돌려준다", ({ value }) => {
      expect(parseMonth(value)).toBeNull();
    });
  });
});

describe("shiftMonth · 달 옮기기", () => {
  describe("정상 처리", () => {
    it.each([
      { label: "+1", delta: 1, expected: "2026-11" },
      { label: "-1", delta: -1, expected: "2026-09" },
    ])("같은 해 안에서 '$label'달 옮긴 달을 돌려준다", ({ delta, expected }) => {
      expect(shiftMonth("2026-10", delta)).toBe(expected);
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "12월 다음", month: "2026-12", delta: 1, expected: "2027-01" },
      { label: "1월 이전", month: "2026-01", delta: -1, expected: "2025-12" },
    ])("'$label'이면 해가 바뀐 달을 돌려준다", ({ month, delta, expected }) => {
      expect(shiftMonth(month, delta)).toBe(expected);
    });
  });
});

describe("monthLabel · 달 표기", () => {
  describe("정상 처리", () => {
    it("'2026-01'을 앞 0 없이 '2026년 1월'로 바꾼다", () => {
      expect(monthLabel("2026-01")).toBe("2026년 1월");
    });
  });
});

describe("startedLabel · 가입 달 표기", () => {
  describe("정상 처리", () => {
    it("가입 일시를 '2026년 9월 시작'으로 바꾼다", () => {
      expect(startedLabel("2026-09-01T10:00:00+09:00")).toBe("2026년 9월 시작");
    });
  });

  describe("경계값", () => {
    it("UTC로는 전달 말일이어도 한국 시간으로 다음 달 1일이면 다음 달로 표기한다", () => {
      expect(startedLabel("2026-08-31T15:00:00Z")).toBe("2026년 9월 시작");
    });
  });
});

describe("formatMinutes · 연습 시간 표기", () => {
  describe("정상 처리", () => {
    it.each([
      { label: "40", minutes: 40, text: "40분" },
      { label: "360", minutes: 360, text: "6시간" },
      { label: "400", minutes: 400, text: "6시간 40분" },
    ])("'$label'분을 '$text'로 바꾼다", ({ minutes, text }) => {
      expect(formatMinutes(minutes)).toBe(text);
    });
  });
});

describe("monthDirection · 달 넘김 방향", () => {
  describe("정상 처리", () => {
    it.each([
      { label: "이전 달", from: "2026-10", to: "2026-09", dir: -1 },
      { label: "다음 달", from: "2026-10", to: "2026-11", dir: 1 },
      { label: "해 넘어 이전 달", from: "2026-01", to: "2025-12", dir: -1 },
    ])("'$label'이면 '$dir'을 돌려준다", ({ from, to, dir }) => {
      expect(monthDirection(from, to)).toBe(dir);
    });
  });

  describe("경계값", () => {
    it("같은 달이면 1을 돌려준다", () => {
      expect(monthDirection("2026-10", "2026-10")).toBe(1);
    });
  });
});

describe("buildCalendar · 스트릭 달력", () => {
  describe("정상 처리", () => {
    it("1일 앞을 빈칸으로 채워 일요일부터 7칸씩 나눈다", () => {
      const weeks = buildCalendar("2026-10", new Set(), "2026-10-13");

      expect(weeks).toHaveLength(5);
      expect(daysOf(weeks[0])).toEqual([null, null, null, null, 1, 2, 3]);
      expect(daysOf(weeks[1])).toEqual([4, 5, 6, 7, 8, 9, 10]);
    });

    it("연습한 날은 연습함으로 표시한다", () => {
      const weeks = buildCalendar("2026-10", OCTOBER_PRACTICED, "2026-10-13");

      expect(dayOf(weeks, 6)?.practiced).toBe(true);
      expect(dayOf(weeks, 4)?.practiced).toBe(false);
    });

    it("오늘 전은 지난날, 오늘은 오늘, 오늘 뒤는 앞날로 나눈다", () => {
      const weeks = buildCalendar("2026-10", OCTOBER_PRACTICED, "2026-10-13");

      expect(dayOf(weeks, 12)?.state).toBe("past");
      expect(dayOf(weeks, 13)?.state).toBe("today");
      expect(dayOf(weeks, 14)?.state).toBe("future");
    });

    it("같은 주에서 이어진 연습한 날끼리 띠를 잇는다", () => {
      const weeks = buildCalendar("2026-10", OCTOBER_PRACTICED, "2026-10-13");

      expect(dayOf(weeks, 6)).toMatchObject({ joinPrev: false, joinNext: true });
      expect(dayOf(weeks, 7)).toMatchObject({ joinPrev: true, joinNext: true });
      expect(dayOf(weeks, 5)).toMatchObject({ joinPrev: false, joinNext: false });
    });
  });

  describe("경계값", () => {
    it("마지막 주의 말일 뒤를 빈칸으로 채워 7칸을 맞춘다", () => {
      // 2026년 9월 30일은 수요일
      const weeks = buildCalendar("2026-09", new Set(), "2026-09-15");

      expect(daysOf(weeks[weeks.length - 1])).toEqual([27, 28, 29, 30, null, null, null]);
    });

    it("토요일과 다음 일요일이 이어져도 주가 바뀌면 띠를 끊는다", () => {
      // 2026년 10월 3일은 토요일, 4일은 일요일
      const weeks = buildCalendar("2026-10", new Set(["2026-10-03", "2026-10-04"]), "2026-10-13");

      expect(dayOf(weeks, 3)?.joinNext).toBe(false);
      expect(dayOf(weeks, 4)?.joinPrev).toBe(false);
    });

    it("일요일에 시작하는 28일짜리 달은 빈칸 없이 4주로 그린다", () => {
      const weeks = buildCalendar("2026-02", new Set(), "2026-03-01");

      expect(weeks).toHaveLength(4);
      expect(daysOf(weeks[0])).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(daysOf(weeks[3])).toEqual([22, 23, 24, 25, 26, 27, 28]);
    });
  });
});
