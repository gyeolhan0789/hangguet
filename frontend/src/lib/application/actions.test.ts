// @vitest-environment node
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplicationCreateRequest, ApplicationResponse, ProblemDetail } from "@/types/api";

const post = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { post } }));

// Next의 redirect는 특별한 오류를 던져 이동시킨다. unstable_rethrow는 그 오류만 다시 던진다.
class RedirectSignal extends Error {}
const redirect = vi.fn((url: string) => {
  throw new RedirectSignal(`REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

const { createApplication } = await import("./actions");

const values = {
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetter: "1. 지원 동기\n저는…",
} satisfies ApplicationCreateRequest;

// Swagger 4.1 201 예시
const created = {
  id: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetter: "1. 지원 동기\n저는…",
  createdAt: "2026-10-15T11:55:00+09:00",
  inUse: false,
} satisfies ApplicationResponse;

function problem(body: ProblemDetail) {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { status: body.status, data: body, headers: {}, config } as AxiosResponse;
  return new AxiosError("fail", undefined, config, null, response);
}

const validationFailed = (errors: ProblemDetail["errors"]): ProblemDetail => ({
  title: "Bad Request",
  status: 400,
  detail: "입력값을 확인해 주세요.",
  instance: "/api/v1/applications",
  code: "VALIDATION_FAILED",
  errors,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createApplication (4.1 지원서 작성)", () => {
  it("앞뒤 공백을 지워 보내고, 성공하면 만든 지원서 id를 들고 S04 면접관 선택으로 간다", async () => {
    post.mockResolvedValue({ data: created });

    await expect(
      createApplication({ ...values, companyName: "  ○○전자 ", jobTitle: "백엔드 개발자\n" }),
    ).rejects.toThrow("REDIRECT /practice/interviewer?applicationId=10");

    expect(post).toHaveBeenCalledWith("/applications", values);
  });

  it.each([
    {
      name: "폼에 있는 칸만 거절 → 칸별 오류",
      errors: [{ field: "coverLetter", reason: "1~3,000자입니다." }],
      expected: { fieldErrors: { coverLetter: "1~3,000자입니다." } },
    },
    {
      name: "폼에 없는 칸만 거절 → 폼 오류(detail)",
      errors: [{ field: "unknown", reason: "필수 값입니다." }],
      expected: { formError: "입력값을 확인해 주세요." },
    },
    {
      name: "폼에 있는 칸과 없는 칸이 섞임 → 칸별 오류 + 폼 오류",
      errors: [
        { field: "companyName", reason: "1~100자입니다." },
        { field: "unknown", reason: "필수 값입니다." },
      ],
      expected: {
        fieldErrors: { companyName: "1~100자입니다." },
        formError: "입력값을 확인해 주세요.",
      },
    },
    {
      name: "칸 정보 없이 거절 → 폼 오류(detail)",
      errors: [],
      expected: { formError: "입력값을 확인해 주세요." },
    },
  ])("VALIDATION_FAILED: $name", async ({ errors, expected }) => {
    post.mockRejectedValue(problem(validationFailed(errors)));

    expect(await createApplication(values)).toEqual(expected);
  });

  it("서버 오류(500)면 서버가 준 문구를 폼 오류로 돌려준다", async () => {
    post.mockRejectedValue(
      problem({
        title: "Internal Server Error",
        status: 500,
        detail: "서버에 문제가 생겼어요.",
        instance: "/api/v1/applications",
        code: "INTERNAL_ERROR",
      }),
    );

    expect(await createApplication(values)).toEqual({ formError: "서버에 문제가 생겼어요." });
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    post.mockRejectedValue(new Error("network"));

    expect(await createApplication(values)).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
  });

  it("api가 401로 재발급 · 로그아웃 화면에 보내면(redirect) 삼키지 않고 그대로 이동한다", async () => {
    post.mockRejectedValue(new RedirectSignal("REDIRECT /api/auth/signed-out?next=%2Fpractice"));

    await expect(createApplication(values)).rejects.toThrow(
      "REDIRECT /api/auth/signed-out?next=%2Fpractice",
    );
  });

  it("빈칸(공백만)이 있으면 서버에 보내지 않는다", async () => {
    const result = await createApplication({ ...values, jobTitle: "   " });

    expect(result.formError).toBeDefined();
    expect(post).not.toHaveBeenCalled();
  });
});
