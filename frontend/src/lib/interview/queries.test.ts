// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axiosProblem } from "@/test/axios-problem";
import type { SessionResponse } from "@/types/api";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { get } }));

const { getCurrentQuestion, getSession } = await import("./queries");

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
  room: null,
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

describe("getCurrentQuestion (5.5 지금 질문)", () => {
  it("200이면 질문 id · 순서 · 내용을 돌려준다", async () => {
    // Swagger 5.5 200 예시
    get.mockResolvedValue({
      status: 200,
      data: {
        id: 303,
        seq: 3,
        content: "흐음~ ○○ 프로젝트라. 거기서 '직접' 한 부분만 쏙 골라서 말해볼래요?",
        createdAt: "2026-10-15T12:06:12+09:00",
      },
    });

    expect(await getCurrentQuestion(55)).toEqual({
      id: 303,
      seq: 3,
      content: "흐음~ ○○ 프로젝트라. 거기서 '직접' 한 부분만 쏙 골라서 말해볼래요?",
    });
    expect(get).toHaveBeenCalledWith("/interview-sessions/55/questions/current");
  });

  it("다음 질문을 만드는 중이면(202 QUESTION_GENERATING) null", async () => {
    // Swagger 5.5 202 예시
    get.mockResolvedValue({ status: 202, data: { code: "QUESTION_GENERATING" } });
    expect(await getCurrentQuestion(55)).toBeNull();
  });

  it.each([
    {
      title: "Not Found",
      status: 404,
      detail: "면접을 찾을 수 없어요.",
      instance: "/api/v1/interview-sessions/0",
      code: "SESSION_NOT_FOUND",
    },
    {
      title: "Conflict",
      status: 409,
      detail: "지금은 할 수 없는 요청이에요.",
      instance: "/api/v1/interview-sessions/55/start",
      code: "INVALID_SESSION_STATE",
    },
  ])("$status $code면 null(Swagger 5.5 예시)", async (problem) => {
    get.mockRejectedValue(axiosProblem(problem));
    expect(await getCurrentQuestion(55)).toBeNull();
  });

  it("그 밖의 실패는 그대로 던진다(오류 화면)", async () => {
    const error = new Error("network");
    get.mockRejectedValue(error);
    await expect(getCurrentQuestion(55)).rejects.toBe(error);
  });
});
