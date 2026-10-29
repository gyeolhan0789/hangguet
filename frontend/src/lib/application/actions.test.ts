// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirectTo } from "@/test/redirect";

import { axiosProblem } from "@/test/axios-problem";
import type { ApplicationCreateRequest, ApplicationResponse, ProblemDetail } from "@/types/api";

// 기준: Swagger 4.1 지원서 작성(coverLetterItems · 201 · 400 VALIDATION_FAILED · 503 COVER_LETTER_CHECK_UNAVAILABLE)
// · 4.5 지원서 삭제(204 · 404 APPLICATION_NOT_FOUND, 면접에 쓴 지원서도 지운다)
// · 사용자 결정(2026-10-29: 저장 뒤 지원서 쓰기를 연 곳으로 — 지원 관리면 새 지원서 상세, S03이면 새 지원서를 골라 둔 S03.
//   삭제에 실패하면 모달에 서버 문구, 204 · 404면 목록으로)
// · Next 16 refresh: 저장 · 삭제가 성공하면 redirect 전에 불러, 뒤로 가기로 돌아간 목록이 BFCache의 옛 4.3을 보여 주지 않게 한다

const { post, del } = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api: { post, delete: del } }));

// Next의 redirect는 특별한 오류를 던져 이동시킨다. unstable_rethrow는 그 오류만 다시 던진다.
class RedirectSignal extends Error {}
// 두 번째 인자(RedirectType)는 toHaveBeenCalledWith로 확인한다.
const redirect = vi.fn<(url: string, type?: string) => never>((url) => {
  throw new RedirectSignal(`REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({
  RedirectType: { push: "push", replace: "replace" },
  redirect: (url: string, type?: string) => redirect(url, type),
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

// 클라이언트 BFCache를 비우는 refresh(서버 액션 전용)
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

/** refresh가 한 번, redirect보다 먼저 불렸다(redirect가 던지면 그 뒤 코드는 돌지 않는다). */
function expectRefreshBeforeRedirect() {
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(redirect).toHaveBeenCalledTimes(1);
  expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(redirect.mock.invocationCallOrder[0]);
}

const { createApplication, deleteApplication } = await import("./actions");

const values = {
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetterItems: [
    { question: "지원 동기", answer: "저는…" },
    { question: "협업 경험", answer: "4명이 함께한…" },
  ],
} satisfies ApplicationCreateRequest;

// Swagger 4.1 201 예시
const created = {
  id: 13,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetterItems: [
    { itemOrder: 1, question: "지원 동기", answer: "저는…" },
    { itemOrder: 2, question: "협업 경험", answer: "4명이 함께한…" },
  ],
  createdAt: "2026-10-29T10:00:00+09:00",
} satisfies ApplicationResponse;

const validationFailed = (errors: ProblemDetail["errors"]): ProblemDetail => ({
  title: "Bad Request",
  status: 400,
  detail: "입력값을 확인해 주세요.",
  instance: "/api/v1/applications",
  code: "VALIDATION_FAILED",
  errors,
});

const signedOut = new RedirectSignal("REDIRECT /api/auth/signed-out?next=%2Fapplications");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createApplication (4.1 지원서 작성)", () => {
  it("문항을 적은 순서대로, 칸마다 앞뒤 공백을 지워 보내고, 지원 관리에서 열었으면 만든 지원서 상세로 간다", async () => {
    post.mockResolvedValue({ data: created });

    await expect(
      createApplication(
        {
          companyName: "  ○○전자 ",
          jobTitle: "백엔드 개발자\n",
          coverLetterItems: [
            { question: " 지원 동기", answer: "저는…\n" },
            { question: "협업 경험 ", answer: " 4명이 함께한…" },
          ],
        },
        "applications",
      ),
    ).rejects.toThrow(redirectTo("/applications/13"));

    expect(post).toHaveBeenCalledWith("/applications", values);
    // 뒤로 가기로 저장한 지원서 쓰기에 돌아가지 않게 기록을 바꿔치기한다
    expect(redirect).toHaveBeenCalledWith("/applications/13", "replace");
    // 뒤로 가기로 돌아간 지원 관리 목록이 새 지원서를 담은 4.3을 다시 받게 한다
    expectRefreshBeforeRedirect();
  });

  it("S03 [+ 추가하기]로 열었으면 만든 지원서를 골라 둔 S03로 돌아간다(막 저장한 표시 added=1)", async () => {
    post.mockResolvedValue({ data: created });

    await expect(createApplication(values, "practice")).rejects.toThrow(
      redirectTo("/practice?applicationId=13&added=1"),
    );
    expect(redirect).toHaveBeenCalledWith("/practice?applicationId=13&added=1", "replace");
    expectRefreshBeforeRedirect();
  });

  it.each([
    {
      // Swagger 4.1 400 예시(질문을 만들기 어려운 자기소개서)
      name: "자기소개서를 거절 → 칸별 오류",
      errors: [
        {
          field: "coverLetterItems",
          reason:
            "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요.",
        },
      ],
      expected: {
        fieldErrors: {
          coverLetterItems:
            "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요.",
        },
      },
    },
    {
      // 문항 하나의 형식 오류는 화면 검사가 먼저 막으므로, 서버가 거절하면 폼 아래 문구(detail)로 알린다.
      name: "문항 하나의 칸만 거절 → 폼 오류(detail)",
      errors: [{ field: "coverLetterItems[0].answer", reason: "1~20,000자입니다." }],
      expected: { formError: "입력값을 확인해 주세요." },
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

    expect(await createApplication(values, "applications")).toEqual(expected);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("자기소개서를 판단하지 못하면(503 COVER_LETTER_CHECK_UNAVAILABLE) 서버 문구를 폼 오류로 돌려준다", async () => {
    // Swagger 4.1 503 예시
    post.mockRejectedValue(
      axiosProblem({
        title: "Service Unavailable",
        status: 503,
        detail: "자기소개서를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        instance: "/api/v1/applications",
        code: "COVER_LETTER_CHECK_UNAVAILABLE",
      }),
    );

    expect(await createApplication(values, "applications")).toEqual({
      formError: "자기소개서를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    post.mockRejectedValue(new Error("network"));

    expect(await createApplication(values, "applications")).toEqual({
      formError: "잠시 후 다시 시도해 주세요.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("api가 401로 재발급 · 로그아웃 화면에 보내면(redirect) 삼키지 않고 그대로 이동한다", async () => {
    post.mockRejectedValue(signedOut);

    await expect(createApplication(values, "applications")).rejects.toBe(signedOut);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    { name: "공백만 있는 직무", input: { ...values, jobTitle: "   " } },
    {
      name: "공백만 있는 답변",
      input: { ...values, coverLetterItems: [{ question: "지원 동기", answer: " " }] },
    },
    {
      name: "6개째 문항",
      input: {
        ...values,
        coverLetterItems: Array.from({ length: 6 }, () => ({ question: "문항", answer: "답변" })),
      },
    },
  ])("$name은 서버에 보내지 않는다", async ({ input }) => {
    const result = await createApplication(input, "applications");

    expect(result).toEqual({ formError: "입력값을 확인해 주세요." });
    expect(post).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("deleteApplication (4.5 지원서 삭제)", () => {
  it("삭제하고(204) 지원 관리 목록으로 간다", async () => {
    del.mockResolvedValue({ status: 204 });

    await expect(deleteApplication(9)).rejects.toThrow(redirectTo("/applications"));
    expect(del).toHaveBeenCalledWith("/applications/9");
    // 뒤로 가기로 지운 지원서의 상세에 돌아가지 않게 기록을 바꿔치기한다
    expect(redirect).toHaveBeenCalledWith("/applications", "replace");
    // 지운 지원서가 뒤로 가기로 돌아간 지원 관리 목록 · S03에 남지 않게 한다
    expectRefreshBeforeRedirect();
  });

  it("이미 없는 지원서(404 APPLICATION_NOT_FOUND)도 목록으로 간다", async () => {
    // Swagger 4.5 404 예시
    del.mockRejectedValue(
      axiosProblem({
        title: "Not Found",
        status: 404,
        detail: "지원서를 찾을 수 없어요.",
        instance: "/api/v1/applications/0",
        code: "APPLICATION_NOT_FOUND",
      }),
    );

    await expect(deleteApplication(10)).rejects.toThrow(redirectTo("/applications"));
    expectRefreshBeforeRedirect();
  });

  it("서버 오류(500 INTERNAL_ERROR)면 이동하지 않고 서버 문구를 돌려준다", async () => {
    del.mockRejectedValue(
      axiosProblem({
        title: "Internal Server Error",
        status: 500,
        detail: "서버에 문제가 생겼어요.",
        instance: "/api/v1/applications/9",
        code: "INTERNAL_ERROR",
      }),
    );

    expect(await deleteApplication(9)).toEqual({ error: "서버에 문제가 생겼어요." });
    expect(redirect).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    del.mockRejectedValue(new Error("network"));

    expect(await deleteApplication(9)).toEqual({ error: "잠시 후 다시 시도해 주세요." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("api가 401로 재발급 · 로그아웃 화면에 보내면(redirect) 삼키지 않고 그대로 이동한다", async () => {
    del.mockRejectedValue(signedOut);

    await expect(deleteApplication(10)).rejects.toBe(signedOut);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "지원서 id가 양의 정수가 아니면(%s) 서버에 보내지 않고 목록으로 간다",
    async (applicationId) => {
      await expect(deleteApplication(applicationId)).rejects.toThrow(redirectTo("/applications"));
      expect(del).not.toHaveBeenCalled();
      // 아무것도 지우지 않았으니 다시 받을 것도 없다
      expect(refresh).not.toHaveBeenCalled();
    },
  );
});
