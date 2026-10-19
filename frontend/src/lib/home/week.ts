import { addDays, weekdayOf } from "@/lib/date";

import type { HomeResponse } from "./types";

/** done: 연습함 · missed: 빠짐(✕) · empty: 아직 기록 없음(첫 방문) · today: 오늘(아직) · today-done: 오늘 연습함 */
export type DayStatus = "done" | "missed" | "empty" | "today" | "today-done";

export interface WeekDay {
  date: string;
  label: string;
  status: DayStatus;
}

/**
 * 홈의 이번 주 7칸: 오늘을 포함한 최근 7일.
 * 현재 스트릭에 들어가는 날은 연습한 것으로 보고, 그 전 날은 practiceDates로 판단한다.
 */
export function buildWeek(home: HomeResponse, today: string): WeekDay[] {
  const practiced = new Set(home.practiceDates);
  const doneToday = home.homeState === "DONE_TODAY" || practiced.has(today);
  // 오늘 연습했으면 스트릭에 오늘이 들어 있다.
  const streakDaysBeforeToday = Math.max(0, home.currentStreak - (doneToday ? 1 : 0));

  return Array.from({ length: 7 }, (_, i) => {
    const offset = i - 6;
    const date = addDays(today, offset);
    if (offset === 0) {
      return { date, label: "오늘", status: doneToday ? "today-done" : "today" };
    }
    let status: DayStatus;
    if (home.homeState === "FIRST_VISIT") status = "empty";
    else if (-offset <= streakDaysBeforeToday || practiced.has(date)) status = "done";
    else status = "missed";
    return { date, label: weekdayOf(date), status };
  });
}
