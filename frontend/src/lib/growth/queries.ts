import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail } from "@/lib/api/problem-detail";
import type { GrowthReviewResponse } from "@/types/api";

// 기준: Swagger 7.1 날짜별 성장 리뷰(GET /growth-reviews/{practiceDate} → 200 GrowthReviewResponse
// · 404 GROWTH_REVIEW_NOT_FOUND(그날 연습 기록 또는 결과가 없음))

/** 7.1 날짜별 성장 리뷰. 그날 리뷰가 없으면(404) null. 서버 컴포넌트에서만 부른다. */
export async function getGrowthReview(practiceDate: string): Promise<GrowthReviewResponse | null> {
  try {
    const { data } = await api.get<GrowthReviewResponse>(
      endpoints.growthReviews.byDate(practiceDate),
    );
    return data;
  } catch (error) {
    if (getProblemDetail(error)?.code === "GROWTH_REVIEW_NOT_FOUND") return null;
    throw error;
  }
}
