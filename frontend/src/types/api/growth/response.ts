// 7. 성장 리뷰 응답. 기준: 웹 Swagger 7.1 · 7.2.
import type { LocalDate, Page } from "../common";

/** 평가 기준. 화면 이름: JOB_FIT 직무 적합성 · COVER_LETTER 자소서 검증 · LOGIC 논리성 · DELIVERY 전달력 */
export type Criterion = "JOB_FIT" | "COVER_LETTER" | "LOGIC" | "DELIVERY";

/** 3단계. GOOD 좋아요 · NORMAL 보통 · WEAK 아쉬워요 */
export type Grade = "GOOD" | "NORMAL" | "WEAK";

/** 최근 성장 리뷰 한 줄(7.2 · 3.1 recentReviews) */
export interface RecentReviewItem {
  /** 연습한 날 */
  practiceDate: LocalDate;
  /** 회사명 */
  companyName: string;
  /** 기준 */
  criterion: Criterion;
  /** 그 기준의 변화량. "전달력 +8" */
  delta: number;
}

/** 기준 하나의 그날 결과 */
export interface CriterionReview {
  criterion: Criterion;
  /** 점수(0~100) */
  score: number;
  /** 3단계. S08-C 기준점 표시 */
  grade: Grade;
  /** 직전 연습일(comparedDate) 대비 변화. "전달력 ↑8". 첫 면접이면 null(S08-C 예시) */
  delta: number | null;
  /** 한 줄 설명 */
  comment: string;
}

/** 7.1 날짜별 성장 리뷰 (200) */
export interface GrowthReviewResponse {
  /** 그날 */
  practiceDate: LocalDate;
  /** 첫 연습일이면 true → S08-C */
  isFirst: boolean;
  /** 비교한 직전 연습일. 첫 연습일이면 null */
  comparedDate: LocalDate | null;
  /** 그날 기준 스트릭. "8일째 연습 완료!" */
  streakOnDate: number;
  /** 연습한 날. 동그라미 */
  practiceDates: LocalDate[];
  /** 그날 연습 면접 수 */
  interviewCount: number;
  /** 그날 연습 면접 시간 합(분) */
  practiceMinutes: number;
  /** 기준 4개 */
  criteria: CriterionReview[];
  /** 다음에 해볼 것 */
  nextActions: string[];
}

/** 7.2 최근 성장 리뷰 (200) */
export type RecentReviewsResponse = Page<RecentReviewItem>;
