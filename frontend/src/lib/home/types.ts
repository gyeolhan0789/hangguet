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

export interface RecentReview extends Improvement {
  practiceDate: string;
  companyName: string;
}

/** 3.1 홈 응답 */
export interface HomeResponse {
  homeState: HomeState;
  currentStreak: number;
  bestStreak: number;
  /** 오늘 스트릭 단계가 올랐으면 S02-1 대신 S02-L을 보여 준다 */
  leveledUpToday: boolean;
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
