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

/** 최근 성장 리뷰의 "전달력 +8" */
export function formatReviewImprovement({ criterion, delta }: RecentReviewItem): string {
  return formatImprovement({ criterion, delta });
}
