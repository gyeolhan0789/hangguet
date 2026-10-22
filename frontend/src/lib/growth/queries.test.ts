// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axiosProblem } from "@/test/axios-problem";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { get } }));

const { getGrowthReview } = await import("./queries");

// 기준: Swagger 7.1 날짜별 성장 리뷰(200 · 404 GROWTH_REVIEW_NOT_FOUND 예시)

beforeEach(() => {
  get.mockReset();
});

describe("getGrowthReview (7.1 날짜별 성장 리뷰)", () => {
  it("그날 리뷰를 돌려준다", async () => {
    const data = { practiceDate: "2026-10-13" };
    get.mockResolvedValue({ data });

    expect(await getGrowthReview("2026-10-13")).toBe(data);
    expect(get).toHaveBeenCalledWith("/growth-reviews/2026-10-13");
  });

  it("그날 리뷰가 없으면(404 GROWTH_REVIEW_NOT_FOUND) null", async () => {
    // Swagger 7.1 404 예시
    get.mockRejectedValue(
      axiosProblem({
        title: "Not Found",
        status: 404,
        detail: "그날의 성장 리뷰가 없어요.",
        instance: "/api/v1/growth-reviews/2026-10-01",
        code: "GROWTH_REVIEW_NOT_FOUND",
      }),
    );

    expect(await getGrowthReview("2026-10-01")).toBeNull();
  });

  it("그 밖의 실패는 그대로 던져 오류 화면에 맡긴다", async () => {
    const error = new Error("network");
    get.mockRejectedValue(error);

    await expect(getGrowthReview("2026-10-13")).rejects.toBe(error);
  });
});
