// 날짜는 API 명세 1장대로 한국 시간 기준 YYYY-MM-DD 문자열로 다룬다.

const KST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 한국 시간 기준 오늘(YYYY-MM-DD) */
export function todayKst(now: Date = new Date()): string {
  return KST_DATE.format(now);
}

/** YYYY-MM-DD에 days일을 더한다 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** YYYY-MM-DD의 요일 한 글자 */
export function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** YYYY-MM-DD → "10.12" */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${month}.${day}`;
}

/** 한국 시간 자정까지 남은 시간 "HH:MM:SS" */
export function untilMidnightKst(now: Date = new Date()): string {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const left = Math.max(0, 86_400_000 - (kstMs % 86_400_000));
  const seconds = Math.floor(left / 1000);
  return [seconds / 3600, (seconds % 3600) / 60, seconds % 60]
    .map((n) => String(Math.floor(n)).padStart(2, "0"))
    .join(":");
}
