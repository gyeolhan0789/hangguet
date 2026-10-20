// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axiosProblem } from "@/test/axios-problem";
import type { SessionResponse } from "@/types/api";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { get } }));

const { getSession } = await import("./queries");

// Swagger 5.2 200 예시 'S05·S05-E 질문 준비 78%'
const session = {
  id: 55,
  applicationId: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  persona: "DEVIL",
  mode: "VIDEO",
  status: "READY",
  planStatus: "GENERATING",
  planProgress: 78,
  analysisStep: null,
  currentQuestion: null,
  answeredCount: 0,
  elapsedSeconds: 0,
  startedAt: null,
  endedAt: null,
  createdAt: "2026-10-15T11:58:30+09:00",
  leveledUp: null,
} satisfies SessionResponse;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSession (5.2 면접 조회)", () => {
  it("면접을 돌려준다", async () => {
    get.mockResolvedValue({ data: session });

    expect(await getSession(55)).toEqual(session);
    expect(get).toHaveBeenCalledWith("/interview-sessions/55");
  });

  it("없는 면접(404 SESSION_NOT_FOUND)이면 null", async () => {
    // Swagger 5.2 404 예시
    get.mockRejectedValue(
      axiosProblem({
        title: "Not Found",
        status: 404,
        detail: "면접을 찾을 수 없어요.",
        instance: "/api/v1/interview-sessions/0",
        code: "SESSION_NOT_FOUND",
      }),
    );

    expect(await getSession(0)).toBeNull();
  });

  it("그 밖의 실패는 그대로 던져 오류 화면에 맡긴다", async () => {
    const error = new Error("network");
    get.mockRejectedValue(error);

    await expect(getSession(55)).rejects.toBe(error);
  });
});
