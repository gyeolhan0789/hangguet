// @vitest-environment node
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { axiosProblem } from "@/test/axios-problem";
import type {
  IdempotencyHeaders,
  ProblemDetail,
  SessionCreateRequest,
  SessionResponse,
} from "@/types/api";

import type { SessionCreateValues } from "./schemas";

// HTTP 경계(api.post)만 바꾸고, 멱등 헤더는 실제 idempotencyHeaders로 만든다.
const post = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api: { post },
}));

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

const { createSession } = await import("./actions");

const KEY = "0f8e2a4c-7b1d-4e3a-9c5f-2d6b8a1e4f70";
const values = {
  applicationId: 10,
  persona: "DEVIL",
  mode: "VIDEO",
} satisfies SessionCreateRequest;

// Swagger 5.1 201 예시
const session = {
  id: 55,
  applicationId: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  persona: "DEVIL",
  mode: "VIDEO",
  status: "READY",
  planStatus: "GENERATING",
  planProgress: 0,
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

describe("sessionCreateSchema", () => {
  // 타입 검사는 tsc가 한다: 스키마나 5.1 요청 타입 어느 쪽이 바뀌어도 여기서 컴파일 오류가 난다.
  it("검증을 통과한 값의 타입이 5.1 요청 타입(SessionCreateRequest)과 같다", () => {
    expectTypeOf<SessionCreateValues>().toEqualTypeOf<SessionCreateRequest>();
  });
});

describe("createSession (5.1 면접 만들기)", () => {
  it.each([
    { mode: "VIDEO", path: "/practice/devices?sessionId=55", next: "S05 장치 점검" },
    { mode: "CHAT", path: "/interview/55", next: "장치 점검 없이 바로 면접" },
  ] as const)(
    "$mode면 지원서 · 면접관 · 방식을 멱등 키와 보내고, $next으로 간다",
    async ({ mode, path }) => {
      post.mockResolvedValue({ data: { ...session, mode } });

      await expect(createSession({ ...values, mode }, KEY)).rejects.toThrow(`REDIRECT ${path}`);

      expect(post).toHaveBeenCalledWith(
        "/interview-sessions",
        { ...values, mode },
        { headers: { "Idempotency-Key": KEY } satisfies IdempotencyHeaders },
      );
    },
  );

  it("갈 곳은 서버가 만든 면접의 방식으로 정한다(같은 키로 다시 보낸 응답도 같은 곳)", async () => {
    post.mockResolvedValue({ data: { ...session, mode: "CHAT" } });

    await expect(createSession({ ...values, mode: "VIDEO" }, KEY)).rejects.toThrow(
      "REDIRECT /interview/55",
    );
  });

  it("그사이 지원서가 없어졌으면(404 APPLICATION_NOT_FOUND) 처음 단계인 S03으로 보낸다", async () => {
    // Swagger 5.1 404 예시
    post.mockRejectedValue(
      axiosProblem({
        title: "Not Found",
        status: 404,
        detail: "지원서를 찾을 수 없어요.",
        instance: "/api/v1/applications/0",
        code: "APPLICATION_NOT_FOUND",
      }),
    );

    await expect(createSession(values, KEY)).rejects.toThrow("REDIRECT /practice");
  });

  it("같은 키를 다른 요청에 썼으면(409 IDEMPOTENCY_KEY_REUSED) 서버 문구와 함께 새 키가 필요하다고 알린다", async () => {
    // Swagger 5.1 409 예시
    const problem = {
      title: "Conflict",
      status: 409,
      detail: "이미 처리된 요청이에요.",
      instance: "/api/v1/interview-sessions",
      code: "IDEMPOTENCY_KEY_REUSED",
    } satisfies ProblemDetail;
    post.mockRejectedValue(axiosProblem(problem));

    expect(await createSession(values, KEY)).toEqual({
      formError: problem.detail,
      keyReused: true,
    });
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    post.mockRejectedValue(new Error("network"));

    expect(await createSession(values, KEY)).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
  });

  it("api가 401로 재발급 · 로그아웃 화면에 보내면(redirect) 삼키지 않고 그대로 이동한다", async () => {
    const signedOut = new RedirectSignal("REDIRECT /api/auth/signed-out?next=%2Fpractice%2Fmode");
    post.mockRejectedValue(signedOut);

    await expect(createSession(values, KEY)).rejects.toBe(signedOut);
  });

  it.each([
    { label: "양수가 아닌 지원서 id", input: { ...values, applicationId: 0 }, key: KEY },
    { label: "정수가 아닌 지원서 id", input: { ...values, applicationId: 1.5 }, key: KEY },
    { label: "5.1이 받지 않는 면접관", input: { ...values, persona: "ANGEL" }, key: KEY },
    { label: "5.1이 받지 않는 방식", input: { ...values, mode: "PHONE" }, key: KEY },
    { label: "UUID가 아닌 멱등 키", input: values, key: "not-a-uuid" },
  ] satisfies { label: string; input: Record<string, unknown>; key: string }[])(
    "$label은 서버에 보내지 않는다",
    async ({ input, key }) => {
      // 서버 액션은 브라우저에서 아무 값이나 보낼 수 있으므로 타입 밖의 값도 넣어 본다.
      expect(await createSession(input as unknown as SessionCreateValues, key)).toEqual({
        formError: "면접 정보를 확인해 주세요.",
      });
      expect(post).not.toHaveBeenCalled();
    },
  );
});
