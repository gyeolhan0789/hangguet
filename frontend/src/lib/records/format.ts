import { durationMinutes } from "@/lib/result/format";
import { PERSONAS } from "@/lib/interview/personas";
import { addDays } from "@/lib/date";
import type { Mode, SessionListItem } from "@/types/api";

// 연습 기록 화면 표시 계산.
// 기준: 웹 Swagger 5.13(persona · mode · startedAt · endedAt · status) · Figma 연습 기록 초안(232:843: '악마 면접관 · 화상 · 20분')
// · Figma S05-1(면접 방식 화상 · 채팅)
// · 사용자 결정(2026-10-23: 달을 넘기면 같은 '일'(그 달에 없으면 말일, 미래면 오늘), 실패는 '분석 실패')

/** 면접 방식 이름(S05-1) */
export const MODE_LABEL: Record<Mode, string> = { VIDEO: "화상", CHAT: "채팅" };

/** '악마 면접관 · 화상 · 20분' */
export function sessionMeta(item: SessionListItem): string {
  const persona = PERSONAS.find((info) => info.persona === item.persona)?.name ?? "";
  return [persona, MODE_LABEL[item.mode], `${durationMinutes(item.startedAt, item.endedAt)}분`]
    .filter(Boolean)
    .join(" · ");
}

/** 분석이 끝나지 않은 면접의 상태 표시. 완료면 null */
export function pendingLabel(item: SessionListItem): string | null {
  if (item.status === "ANALYZING") return "분석 중";
  if (item.status === "FAILED") return "분석 실패";
  return null;
}

/** YYYY-MM-DD → '10월 21일' */
export function monthDayLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}월 ${day}일`;
}

/**
 * month(YYYY-MM)로 넘어갈 때 고를 날짜. 지금 고른 날과 같은 '일'(그 달에 없으면 말일), 오늘보다 뒤면 오늘.
 * 오늘이 든 달보다 뒤의 달은 고를 수 없어 null.
 */
export function dateInMonth(month: string, selected: string, today: string): string | null {
  // 오늘이 든 달보다 뒤이거나, 웹 Swagger 5.15 month 범위(연도 0001~)를 벗어나면 넘길 수 없다.
  if (month > today.slice(0, 7) || month < "0001-01") return null;
  const lastDay = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  const day = Math.min(Number(selected.slice(8, 10)), lastDay);
  const date = addDays(`${month}-01`, day - 1);
  return date > today ? today : date;
}
