import type { Criterion, Improvement, RecentReviewItem } from "@/types/api";

export const CRITERION_LABEL: Record<Criterion, string> = {
  JOB_FIT: "직무 적합성",
  COVER_LETTER: "자소서 검증",
  LOGIC: "논리성",
  DELIVERY: "전달력",
};

/** "전달력 +8" */
export function formatImprovement({ criterion, delta }: Improvement): string {
  return `${CRITERION_LABEL[criterion]} ${delta >= 0 ? "+" : ""}${delta}`;
}

/**
 * 최근 성장 리뷰의 "전달력 +8"(오른 기준이 없으면 "전달력 +0"). 첫 연습일이면 비교할 날이 없어 null
 * (사용자 결정 2026-10-27: 첫 연습일이면 배지를 숨긴다)
 */
export function formatReviewImprovement({ criterion, delta }: RecentReviewItem): string | null {
  return criterion === null || delta === null ? null : formatImprovement({ criterion, delta });
}
