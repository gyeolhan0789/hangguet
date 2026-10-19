/** 홈 종류: S02 오늘 미완료 · S02-B 오늘 완료 · S02-C 스트릭 끊김 · S02-D 첫 방문 */
export type HomeState = "NOT_DONE_TODAY" | "DONE_TODAY" | "BROKEN" | "FIRST_VISIT";

/** 평가 기준 */
export type Criterion = "JOB_FIT" | "COVER_LETTER" | "LOGIC" | "DELIVERY";

export const CRITERION_LABEL: Record<Criterion, string> = {
  JOB_FIT: "직무 적합성",
  COVER_LETTER: "자소서 검증",
  LOGIC: "논리성",
  DELIVERY: "전달력",
};

export interface Improvement {
  criterion: Criterion;
  /** 직전 연습일 대비 오른 점수 */
  delta: number;
}

/** 최근 성장 리뷰 항목(7.2 형식) */
export interface RecentReview {
  practiceDate: string;
  /** 그날 마지막 면접의 회사명 */
  companyName: string;
  /** 그날 가장 많이 오른 기준. 첫 연습일이면 비교할 날이 없어 null */
  criterion: Criterion | null;
  /** 그 기준의 변화량. 첫 연습일이면 null */
  delta: number | null;
}

/** 3.1 홈 응답 */
export interface HomeResponse {
  homeState: HomeState;
  currentStreak: number;
  bestStreak: number;
  /** 연습한 날짜(YYYY-MM-DD) */
  practiceDates: string[];
  todayInterviewCount: number;
  todayPracticeMinutes: number;
  todayImprovements: Improvement[];
  /** 직전 성장 리뷰의 '다음에 해볼 것' */
  nextActions: string[];
  nextActionsDate: string | null;
  recentReviews: RecentReview[];
}

/** "전달력 +8" */
export function formatImprovement({ criterion, delta }: Improvement): string {
  return `${CRITERION_LABEL[criterion]} ${delta >= 0 ? "+" : ""}${delta}`;
}

/** 최근 성장 리뷰의 "전달력 +8". 첫 연습일이라 비교할 값이 없으면 null */
export function formatReviewImprovement({ criterion, delta }: RecentReview): string | null {
  return criterion !== null && delta !== null ? formatImprovement({ criterion, delta }) : null;
}
