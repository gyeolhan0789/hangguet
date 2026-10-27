// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axiosProblem } from "@/test/axios-problem";
import type { ApplicationResponse } from "@/types/api";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { get } }));

const { getApplication } = await import("./queries");

// Swagger 4.2 200 예시
const application = {
  id: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetter: "1. 지원 동기\n저는…",
  createdAt: "2026-10-15T11:55:00+09:00",
  inUse: false,
} satisfies ApplicationResponse;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getApplication (4.2 지원서 조회)", () => {
  it("지원서를 돌려준다", async () => {
    get.mockResolvedValue({ data: application });

    expect(await getApplication(10)).toEqual(application);
    expect(get).toHaveBeenCalledWith("/applications/10");
  });

  it("없는 지원서(404 APPLICATION_NOT_FOUND)면 null", async () => {
    // Swagger 4.2 404 예시
    get.mockRejectedValue(
      axiosProblem({
        title: "Not Found",
        status: 404,
        detail: "지원서를 찾을 수 없어요.",
        instance: "/api/v1/applications/0",
        code: "APPLICATION_NOT_FOUND",
      }),
    );

    expect(await getApplication(0)).toBeNull();
  });

  it.each([
    {
      name: "다른 오류 응답(500 INTERNAL_ERROR)",
      error: axiosProblem({
        title: "Internal Server Error",
        status: 500,
        detail: "잠시 후 다시 시도해 주세요.",
        instance: "/api/v1/applications/10",
        code: "INTERNAL_ERROR",
      }),
    },
    { name: "서버에 닿지 못함", error: new Error("network") },
  ])("$name이면 그대로 던진다", async ({ error }) => {
    get.mockRejectedValue(error);

    await expect(getApplication(10)).rejects.toBe(error);
  });
});
