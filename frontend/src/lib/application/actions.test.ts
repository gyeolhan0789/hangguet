// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirectTo } from "@/test/redirect";

import { axiosProblem } from "@/test/axios-problem";
import type {
  ApplicationCreateRequest,
  ApplicationResponse,
  ApplicationUpdateRequest,
  ProblemDetail,
} from "@/types/api";

const post = vi.fn();
const patch = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { post, patch } }));

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

const { createApplication, updateApplication } = await import("./actions");

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

const validationFailed = (errors: ProblemDetail["errors"]): ProblemDetail => ({
  title: "Bad Request",
  status: 400,
  detail: "입력값을 확인해 주세요.",
  instance: "/api/v1/applications",
  code: "VALIDATION_FAILED",
  errors,
});

const signedOut = new RedirectSignal("REDIRECT /api/auth/signed-out?next=%2Fpractice");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createApplication (4.1 지원서 작성)", () => {
  it("앞뒤 공백을 지워 보내고, 성공하면 만든 지원서 id를 들고 S04 면접관 선택으로 간다", async () => {
    post.mockResolvedValue({ data: created });

    await expect(
      createApplication({ ...values, companyName: "  ○○전자 ", jobTitle: "백엔드 개발자\n" }),
    ).rejects.toThrow(redirectTo("/practice/interviewer?applicationId=10"));

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
    post.mockRejectedValue(axiosProblem(validationFailed(errors)));

    expect(await createApplication(values)).toEqual(expected);
  });

  it("서버 오류(500)면 서버가 준 문구를 폼 오류로 돌려준다", async () => {
    post.mockRejectedValue(
      axiosProblem({
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
    post.mockRejectedValue(signedOut);

    await expect(createApplication(values)).rejects.toBe(signedOut);
  });

  it("빈칸(공백만)이 있으면 서버에 보내지 않는다", async () => {
    const result = await createApplication({ ...values, jobTitle: "   " });

    expect(result).toEqual({ formError: "입력값을 확인해 주세요." });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("updateApplication (4.4 지원서 수정, S04 [← 지원서 수정])", () => {
  it("앞뒤 공백을 지운 세 칸을 4.4로 보내고, 저장되면 같은 지원서로 S04 면접관 선택에 돌아간다", async () => {
    patch.mockResolvedValue({ data: created });

    await expect(
      updateApplication(10, { ...values, companyName: " ○○전자 본사 " }),
    ).rejects.toThrow(redirectTo("/practice/interviewer?applicationId=10"));

    expect(patch).toHaveBeenCalledWith("/applications/10", {
      ...values,
      companyName: "○○전자 본사",
    } satisfies ApplicationUpdateRequest);
  });

  // Swagger 4.4 404 · 409 예시
  it.each([
    {
      name: "없는 지원서(404 APPLICATION_NOT_FOUND)",
      problem: {
        title: "Not Found",
        status: 404,
        detail: "지원서를 찾을 수 없어요.",
        instance: "/api/v1/applications/0",
        code: "APPLICATION_NOT_FOUND",
      },
    },
    {
      name: "면접에 쓴 지원서(409 APPLICATION_IN_USE)",
      problem: {
        title: "Conflict",
        status: 409,
        detail: "면접에 사용한 지원서는 수정하거나 삭제할 수 없어요.",
        instance: "/api/v1/applications/9",
        code: "APPLICATION_IN_USE",
      },
    },
  ] satisfies { name: string; problem: ProblemDetail }[])(
    "$name면 서버 문구를 폼 오류로 돌려준다",
    async ({ problem }) => {
      patch.mockRejectedValue(axiosProblem(problem));

      expect(await updateApplication(9, values)).toEqual({ formError: problem.detail });
    },
  );

  it("api가 401로 재발급 · 로그아웃 화면에 보내면(redirect) 삼키지 않고 그대로 이동한다", async () => {
    patch.mockRejectedValue(signedOut);

    await expect(updateApplication(10, values)).rejects.toBe(signedOut);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "지원서 id가 양의 정수가 아니면(%s) 서버에 보내지 않는다",
    async (applicationId) => {
      expect(await updateApplication(applicationId, values)).toEqual({
        formError: "지원서를 찾을 수 없어요.",
      });
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it("빈칸(공백만)이 있으면 서버에 보내지 않는다", async () => {
    const result = await updateApplication(10, { ...values, coverLetter: " " });

    expect(result).toEqual({ formError: "입력값을 확인해 주세요." });
    expect(patch).not.toHaveBeenCalled();
  });
});
