// @vitest-environment node
// 기준: Swagger 7.1 날짜별 성장 리뷰(200 GrowthReviewResponse · 404 GROWTH_REVIEW_NOT_FOUND(그날 연습 기록 또는 결과가 없음))
import { describe, expect, it, vi } from "vitest";

import { axiosProblem, axiosStatusOnly } from "@/test/axios-problem";

import { getGrowthReview } from "./queries";

// 경계 mock: HTTP(api)
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));

// 예시 데이터: Swagger 7.1 404 예시
const GROWTH_REVIEW_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "그날의 성장 리뷰가 없어요.",
  instance: "/api/v1/growth-reviews/2026-10-14",
  code: "GROWTH_REVIEW_NOT_FOUND",
};

describe("getGrowthReview · 7.1 날짜별 성장 리뷰 불러오기", () => {
  describe("오류 처리", () => {
    it("그날 리뷰가 없으면(404 GROWTH_REVIEW_NOT_FOUND) null을 돌려준다", async () => {
      api.get.mockRejectedValue(axiosProblem(GROWTH_REVIEW_NOT_FOUND));

      expect(await getGrowthReview("2026-10-14")).toBeNull();
    });

    it("그 밖의 실패(문구 없는 502)면 오류를 그대로 던진다", async () => {
      const error = axiosStatusOnly(502);
      api.get.mockRejectedValue(error);

      await expect(getGrowthReview("2026-10-14")).rejects.toBe(error);
    });
  });
});
