// @vitest-environment node
// 기준: 웹 Swagger 3.1 practiceDates(한국 시간 면접 시작 날짜 기준) · homeState · Figma S02 이번 주 동그라미
import { describe, expect, it } from "vitest";

import { FIXTURE_TODAY, HOME_DONE, HOME_FIRST, HOME_NOT_DONE } from "./fixtures";
import { buildWeek } from "./week";

// 예시 데이터: Swagger 3.1 예시(오늘 2026-10-15 목요일, 현 lib/home/fixtures.ts)
const statuses = (home: typeof HOME_NOT_DONE) =>
  buildWeek(home, FIXTURE_TODAY).map((day) => day.status);

describe("buildWeek · 홈 이번 주 7칸", () => {
  describe("정상 처리", () => {
    it("오늘을 마지막으로 최근 7일을 요일과 '오늘'로 쓴다", () => {
      const week = buildWeek(HOME_NOT_DONE, FIXTURE_TODAY);

      expect(week.map(({ date, label }) => ({ date, label }))).toEqual([
        { date: "2026-10-09", label: "금" },
        { date: "2026-10-10", label: "토" },
        { date: "2026-10-11", label: "일" },
        { date: "2026-10-12", label: "월" },
        { date: "2026-10-13", label: "화" },
        { date: "2026-10-14", label: "수" },
        { date: "2026-10-15", label: "오늘" },
      ]);
    });

    it("지난 날이 practiceDates에 있으면 연습함으로 둔다", () => {
      expect(statuses(HOME_NOT_DONE).slice(0, 6)).toEqual([
        "done",
        "done",
        "done",
        "done",
        "done",
        "done",
      ]);
    });

    it("지난 날이 practiceDates에 없으면 스트릭이 이어져 있어도 빠짐으로 둔다", () => {
      // 스트릭 7일째(10-09 ~ 10-14 연속)인데 practiceDates에는 10-10 · 10-12 · 10-13이 없다
      const home = { ...HOME_NOT_DONE, practiceDates: ["2026-10-09", "2026-10-11", "2026-10-14"] };

      const week = statuses(home);
      expect([week[1], week[3], week[4]]).toEqual(["missed", "missed", "missed"]);
    });

    it("첫 방문이면 지난 6일을 모두 기록 없음으로 둔다", () => {
      expect(statuses(HOME_FIRST).slice(0, 6)).toEqual([
        "empty",
        "empty",
        "empty",
        "empty",
        "empty",
        "empty",
      ]);
    });

    it("오늘 아직이면 오늘 칸을 아직 안 함으로 둔다", () => {
      expect(statuses(HOME_NOT_DONE).at(-1)).toBe("today");
    });

    it("오늘 연습을 마쳤으면 오늘 칸을 연습함으로 둔다", () => {
      const home = { ...HOME_DONE, practiceDates: HOME_NOT_DONE.practiceDates };

      expect(statuses(home).at(-1)).toBe("today-done");
    });
  });
});
