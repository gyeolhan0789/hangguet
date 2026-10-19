// 7. 성장 리뷰 요청. 기준: mock GrowthReviewController.
import type { LocalDate, PageQuery } from "../common";

/** 7.1 GET /growth-reviews/{practiceDate} 경로 값 */
export interface GrowthReviewPath {
  /** 연습한 날짜(YYYY-MM-DD, 한국 시간) */
  practiceDate: LocalDate;
}

/** 7.2 GET /growth-reviews 쿼리. page 기본 0, size 기본 2(1~20) */
export type RecentReviewsQuery = PageQuery;
