// 7. 성장 리뷰 응답. 기준: mock GrowthDtos · GrowthReviewController.
import type { LocalDate, Page } from "../common";

/** 평가 기준. 화면 이름: JOB_FIT 직무 적합성 · COVER_LETTER 자소서 검증 · LOGIC 논리성 · DELIVERY 전달력 */
export type Criterion = "JOB_FIT" | "COVER_LETTER" | "LOGIC" | "DELIVERY";

/** 3단계. GOOD 좋아요 · NORMAL 보통 · WEAK 아쉬워요. 점수 경계는 B-4 */
export type Grade = "GOOD" | "NORMAL" | "WEAK";

/** 최근 성장 리뷰 한 줄(7.2 · 3.1 recentReviews) */
export interface RecentReviewItem {
  /** 연습한 날 */
  practiceDate: LocalDate;
  /** 그날 마지막 면접의 회사명 */
  companyName: string;
  /** 그날 가장 많이 오른 기준. 첫 연습일이면 null */
  criterion: Criterion | null;
  /** 그 기준의 변화량. "전달력 +8". 첫 연습일이면 null */
  delta: number | null;
}

/** 기준 하나의 그날 결과 */
export interface CriterionReview {
  criterion: Criterion;
  /** 그날 결과가 나온 면접들의 평균 점수(0~100) */
  score: number;
  /** 3단계. S08-C 기준점 표시 */
  grade: Grade;
  /** 직전 연습일 대비 변화. "전달력 ↑8". 첫 연습일이면 null. 자소서 검증은 화면에서 delta 없이 comment만 표시 */
  delta: number | null;
  /** 그날 마지막 면접의 한 줄 설명 */
  comment: string | null;
}

/** 7.1 날짜별 성장 리뷰 (200) */
export interface GrowthReviewResponse {
  /** 그날 */
  practiceDate: LocalDate;
  /** 첫 연습일이면 true → S08-C */
  isFirst: boolean;
  /** 비교한 직전 연습일. 첫 연습일이면 null */
  comparedDate: LocalDate | null;
  /** 그날 기준 스트릭. "8일째 연습 완료!". 설문 유도(3·7·21일째) 판단에도 쓴다 */
  streakOnDate: number;
  /** 그날 포함 최근 7일 중 연습한 날. 동그라미 */
  practiceDates: LocalDate[];
  /** 그날 연습 면접 수 */
  interviewCount: number;
  /** 그날 연습 면접 시간 합(분) */
  practiceMinutes: number;
  /** 기준 4개 */
  criteria: CriterionReview[];
  /** 다음에 해볼 것. 최저 점수가 같으면 여러 개 */
  nextActions: string[];
}

/** 7.2 최근 성장 리뷰 (200) */
export type RecentReviewsResponse = Page<RecentReviewItem>;
