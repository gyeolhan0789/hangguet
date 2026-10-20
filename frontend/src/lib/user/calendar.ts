// S09 마이페이지 스트릭 달력 · 통계 표시 계산. 날짜는 한국 시간 YYYY-MM-DD 문자열로 다룬다(API 명세 1장).
// 기준: Figma S09 Streak Calendar(18:2930: 일~토 7칸 · 연습한 날 주황 동그라미 · 연속한 날은 띠로 이어짐(주가 바뀌면 끊김)
// · 오늘 주황 테두리 · 지난날 · 오늘은 누를 수 있고 앞날은 못 누름) · 기획 메모 S09(18:1173: 연속 연습한 날은 띠로 이어 보여줌)
// · API 명세 3.3("'이번 달 10일 연습'은 content 개수, 연속일 띠는 날짜가 이어지는지로 화면이 그린다")

import { addDays } from "@/lib/date";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 주소의 month(YYYY-MM, 3.3과 같은 형식)를 읽는다. 없거나 형식이 틀리면 null */
export function parseMonth(value: string | string[] | undefined): string | null {
  return typeof value === "string" && MONTH.test(value) ? value : null;
}

/** YYYY-MM-DD → YYYY-MM */
export const monthOf = (date: string) => date.slice(0, 7);

/** YYYY-MM에 delta달을 더한다 */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** YYYY-MM → "2026년 10월" */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${year}년 ${m}월`;
}

/** 가입 일시(OffsetDateTime) → "2026년 9월 시작" (한국 시간 기준) */
export function startedLabel(createdAt: string): string {
  const kst = new Date(new Date(createdAt).getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 시작`;
}

/** 연습 시간(분) → "6시간 40분" · "40분" · "6시간" */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}분`;
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
}

export type DayState = "past" | "today" | "future";

export interface CalendarDay {
  date: string;
  /** 1~31 */
  day: number;
  practiced: boolean;
  state: DayState;
  /** 같은 주에서 전날도 연습했으면 왼쪽 띠를 잇는다 */
  joinPrev: boolean;
  /** 같은 주에서 다음 날도 연습했으면 오른쪽 띠를 잇는다 */
  joinNext: boolean;
}

/** 한 주(일~토). 그달이 아닌 칸은 null */
export type CalendarWeek = (CalendarDay | null)[];

/** month(YYYY-MM)의 달력. practiced는 그달 연습한 날(3.3 content의 practiceDate) */
export function buildCalendar(
  month: string,
  practiced: ReadonlySet<string>,
  today: string,
): CalendarWeek[] {
  const first = `${month}-01`;
  const lastDay = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  const offset = new Date(`${first}T00:00:00Z`).getUTCDay();

  const cells: (CalendarDay | null)[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= lastDay; day++) {
    const date = addDays(first, day - 1);
    const column = (offset + day - 1) % 7;
    const isPracticed = practiced.has(date);
    cells.push({
      date,
      day,
      practiced: isPracticed,
      state: date < today ? "past" : date === today ? "today" : "future",
      joinPrev: isPracticed && column > 0 && day > 1 && practiced.has(addDays(date, -1)),
      joinNext: isPracticed && column < 6 && day < lastDay && practiced.has(addDays(date, 1)),
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}
