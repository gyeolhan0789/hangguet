// 3. 홈 · 스트릭 응답. 기준: 웹 Swagger 3.1 ~ 3.3.
import type { LocalDate, OffsetDateTime } from "../common";
import type { Criterion, RecentReviewItem } from "../growth/response";

/** 어떤 홈을 그릴지. NOT_DONE_TODAY 오늘 미완료(S02) · DONE_TODAY 오늘 완료(S02-B) · BROKEN 스트릭 끊김(S02-C) · FIRST_VISIT 연습 기록 없음(S02-D) */
export type HomeState = "NOT_DONE_TODAY" | "DONE_TODAY" | "BROKEN" | "FIRST_VISIT";

/** 오늘 점수가 오른 기준 */
export interface Improvement {
  criterion: Criterion;
  /** 오른 점수 */
  delta: number;
}

/** 3.1 홈 (200) */
export interface HomeResponse {
  homeState: HomeState;
  /** 현재 스트릭 */
  currentStreak: number;
  /** 가장 길었던 스트릭. S02-C "지난 최고 기록" */
  bestStreak: number;
  /** 연습한 날(한국 시간 면접 시작 날짜, 웹 Swagger 3.1). 이번 주 동그라미 */
  practiceDates: LocalDate[];
  /** 오늘 연습 면접 수. S02-B "면접 1회" */
  todayInterviewCount: number;
  /** 오늘 연습 면접 시간 합(분). S02-B "18분" */
  todayPracticeMinutes: number;
  /** 오늘 점수가 오른 기준. S02-B "전달력 +8 · 논리성 +4". 없으면 빈 배열(S02 예시) */
  todayImprovements: Improvement[];
  /** 성장 리뷰의 "다음에 해볼 것". S02 "어제의 나에게서". 없으면 빈 배열(S02-D 예시) */
  nextActions: string[];
  /** 그 성장 리뷰의 날짜. S02 "10.12 성장 리뷰의…". 없으면 null(S02-D 예시) */
  nextActionsDate: LocalDate | null;
  /** 최근 성장 리뷰(7.2 항목 형식), 최근 날짜 순. S02-C "지난번 마지막 연습"은 첫 항목 */
  recentReviews: RecentReviewItem[];
}

/** 3.2 통계 (200) */
export interface StatsResponse {
  /** 현재 스트릭 */
  currentStreak: number;
  /** 최장 스트릭 */
  bestStreak: number;
  /** 연습 면접 수. "총 면접 23회" */
  totalInterviewCount: number;
  /** 연습 면접 시간 합(분). "총 연습 시간 6시간 40분" */
  totalPracticeMinutes: number;
  /** 직무. "백엔드 개발자 준비 중" */
  latestJobTitle: string;
}

/** 그달 연습한 날 하나 */
export interface PracticeLogItem {
  /** 연습한 날 */
  practiceDate: LocalDate;
  /** 일시 */
  createdAt: OffsetDateTime;
}

/** 3.3 연습 달력 (200) */
export interface PracticeLogsResponse {
  /** 그달 연습한 날(한국 시간 면접 시작 날짜, 웹 Swagger 3.3) */
  content: PracticeLogItem[];
}
