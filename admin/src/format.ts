// 날짜 표시. 서버 날짜(YYYY-MM-DD)와 일시(+09:00)를 한국 시간 그대로 쓴다.

/** 2026-10-31 → 2026.10.31 */
export function dotDate(date: string) {
  return date.slice(0, 10).replaceAll('-', '.')
}

/** 2026-10-31 → 10.31 */
export function monthDay(date: string) {
  return date.slice(5, 10).replace('-', '.')
}

/** 한국 시간 오늘(YYYY-MM-DD) */
export function todayKst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
