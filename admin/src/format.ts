// 날짜 표시. 서버 날짜(YYYY-MM-DD)와 일시(+09:00)를 한국 시간 그대로 쓴다.

/** 2026-10-31 → 2026.10.31 */
export function dotDate(date: string) {
  return date.slice(0, 10).replaceAll('-', '.')
}

/** 2026-10-31 → 10.31 */
export function monthDay(date: string) {
  return date.slice(5, 10).replace('-', '.')
}

/** 2026-10-23T09:00:00+09:00 → 2026.10.23 09:00 */
export function dotDateTime(dateTime: string) {
  return `${dotDate(dateTime)} ${dateTime.slice(11, 16)}`
}

/**
 * 게시 기간(A02): '2026.10.23 09:00 ~ 10.30 04:00'. 종료가 시작과 같은 해면 연도를 빼고, 없으면 '계속'.
 * 서버 일시는 +09:00(한국 시간)이라 문자열을 그대로 자른다.
 */
export function period(startsAt: string, endsAt: string | null) {
  if (!endsAt) return `${dotDateTime(startsAt)} ~ 계속`
  const end = endsAt.slice(0, 4) === startsAt.slice(0, 4) ? `${monthDay(endsAt)} ${endsAt.slice(11, 16)}` : dotDateTime(endsAt)
  return `${dotDateTime(startsAt)} ~ ${end}`
}

/** 서버 일시(+09:00) ↔ datetime-local 입력값(YYYY-MM-DDTHH:mm, 한국 시간) */
export function toLocalInput(dateTime: string) {
  return dateTime.slice(0, 16)
}

export function fromLocalInput(value: string) {
  return `${value.slice(0, 16)}:00+09:00`
}

/** 한국 시간 오늘(YYYY-MM-DD) */
export function todayKst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
