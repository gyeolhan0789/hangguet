// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axiosProblem } from "@/test/axios-problem";
import type {
  ApplicationListResponse,
  ApplicationResponse,
  ApplicationSessionListResponse,
} from "@/types/api";

// 기준: Swagger 4.2 지원서 조회 · 4.3 지원서 목록 · 4.6 지원서의 연습 면접 목록(200 · 404 APPLICATION_NOT_FOUND)

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ api: { get } }));

const { getApplication, getApplications, getApplicationSessions } = await import("./queries");

// Swagger 4.2 200 예시
const application = {
  id: 12,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetterItems: [
    { itemOrder: 1, question: "지원 동기", answer: "저는…" },
    { itemOrder: 2, question: "협업 경험", answer: "4명이 함께한…" },
  ],
  createdAt: "2026-10-15T11:55:00+09:00",
} satisfies ApplicationResponse;

// Swagger 4.2 · 4.5 · 4.6 404 예시
const notFound = axiosProblem({
  title: "Not Found",
  status: 404,
  detail: "지원서를 찾을 수 없어요.",
  instance: "/api/v1/applications/0",
  code: "APPLICATION_NOT_FOUND",
});

const otherFailures = [
  {
    name: "다른 오류 응답(500 INTERNAL_ERROR)",
    error: axiosProblem({
      title: "Internal Server Error",
      status: 500,
      detail: "잠시 후 다시 시도해 주세요.",
      instance: "/api/v1/applications/12",
      code: "INTERNAL_ERROR",
    }),
  },
  { name: "서버에 닿지 못함", error: new Error("network") },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getApplication (4.2 지원서 조회)", () => {
  it("지원서를 돌려준다", async () => {
    get.mockResolvedValue({ data: application });

    expect(await getApplication(12)).toEqual(application);
    expect(get).toHaveBeenCalledWith("/applications/12");
  });

  it("없는 지원서(404 APPLICATION_NOT_FOUND)면 null", async () => {
    get.mockRejectedValue(notFound);

    expect(await getApplication(0)).toBeNull();
  });

  it.each(otherFailures)("$name이면 그대로 던진다", async ({ error }) => {
    get.mockRejectedValue(error);

    await expect(getApplication(12)).rejects.toBe(error);
  });
});

describe("getApplications (4.3 지원서 목록)", () => {
  // Swagger 4.3 200 예시
  const list = {
    content: [
      {
        id: 12,
        companyName: "○○전자",
        jobTitle: "백엔드 개발자",
        createdAt: "2026-10-15T11:55:00+09:00",
      },
      {
        id: 9,
        companyName: "△△소프트",
        jobTitle: "서버 개발자",
        createdAt: "2026-10-11T20:10:00+09:00",
      },
    ],
    page: { size: 10, number: 0, totalElements: 2, totalPages: 1 },
  } satisfies ApplicationListResponse;

  it("page · size를 쿼리로 보내고 목록을 돌려준다", async () => {
    get.mockResolvedValue({ data: list });

    expect(await getApplications(1, 20)).toEqual(list);
    expect(get).toHaveBeenCalledWith("/applications", { params: { page: 1, size: 20 } });
  });

  it("실패하면 그대로 던진다(화면의 오류 처리에 맡긴다)", async () => {
    const error = new Error("network");
    get.mockRejectedValue(error);

    await expect(getApplications(0, 10)).rejects.toBe(error);
  });
});

describe("getApplicationSessions (4.6 지원서의 연습 면접 목록)", () => {
  // Swagger 4.6 200 예시(지원서 12: 결과가 나온 면접 2건)
  const sessions = {
    content: [
      {
        id: 55,
        companyName: "○○전자",
        jobTitle: "백엔드 개발자",
        persona: "DEVIL",
        mode: "VIDEO",
        status: "COMPLETED",
        startedAt: "2026-10-21T20:00:00+09:00",
        endedAt: "2026-10-21T20:20:00+09:00",
        answeredCount: 5,
        summary: "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
        criterionGrades: [],
      },
    ],
    page: { size: 10, number: 0, totalElements: 1, totalPages: 1 },
  } satisfies ApplicationSessionListResponse;

  it("지원서 id를 주소에, page · size를 쿼리로 보내고 목록을 돌려준다", async () => {
    get.mockResolvedValue({ data: sessions });

    expect(await getApplicationSessions(12, 1, 10)).toEqual(sessions);
    expect(get).toHaveBeenCalledWith("/applications/12/interview-sessions", {
      params: { page: 1, size: 10 },
    });
  });

  it("없는 지원서(404 APPLICATION_NOT_FOUND)면 null", async () => {
    get.mockRejectedValue(notFound);

    expect(await getApplicationSessions(0, 0, 10)).toBeNull();
  });

  it.each(otherFailures)("$name이면 그대로 던진다", async ({ error }) => {
    get.mockRejectedValue(error);

    await expect(getApplicationSessions(12, 0, 10)).rejects.toBe(error);
  });
});
