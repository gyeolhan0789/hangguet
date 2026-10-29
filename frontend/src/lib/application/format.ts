import { PERSONAS } from "@/lib/interview/personas";
import { MODE_LABEL } from "@/lib/records/format";
import type { SessionListItem } from "@/types/api";

// 지원서 날짜 표시. 기준: Figma 지원 관리 · 목록 · 상세 · S03 지원서 선택(작성일 'YYYY.MM.DD') · Swagger 4.2 · 4.3 createdAt
// · Figma 지원 관리 · 상세 · 면접에 씀(면접 기록 줄 '10.21 · 개발자 커피챗 · 채팅') · Swagger 4.6(startedAt · persona · mode)

/** 2026-10-15T11:55:00+09:00 → 2026.10.15(서버 일시는 +09:00이라 그대로 자른다) */
export const applicationDate = (dateTime: string) => dateTime.slice(0, 10).replaceAll("-", ".");

/** 면접 기록 줄 제목 '10.21 · 개발자 커피챗 · 채팅'(시작 일시는 +09:00이라 그대로 자른다) */
export function applicationSessionTitle(item: SessionListItem): string {
  const persona = PERSONAS.find((info) => info.persona === item.persona)?.name ?? "";
  return [item.startedAt.slice(5, 10).replace("-", "."), persona, MODE_LABEL[item.mode]]
    .filter(Boolean)
    .join(" · ");
}
