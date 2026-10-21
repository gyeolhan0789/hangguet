// @vitest-environment node
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { axiosNoResponse, axiosProblem, axiosStatusOnly } from "@/test/axios-problem";
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

// 5.3 성공 뒤 화면을 다시 그리는 refresh(서버 액션 전용)
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const { createSession, issueSttToken, retryPlan, startSession } = await import("./actions");

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

  it("갈 곳은 고른 방식으로 정한다: 채팅이면 응답의 방식과 상관없이 장치 점검 없이 바로 면접으로 간다", async () => {
    // 목 서버 5.1은 본문과 상관없이 늘 VIDEO 예시를 준다.
    post.mockResolvedValue({ data: { ...session, mode: "VIDEO" } });

    await expect(createSession({ ...values, mode: "CHAT" }, KEY)).rejects.toThrow(
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

// Swagger 5.2~5.4 오류 예시
const SESSION_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "면접을 찾을 수 없어요.",
  instance: "/api/v1/interview-sessions/0",
  code: "SESSION_NOT_FOUND",
} satisfies ProblemDetail;

describe("retryPlan (5.3 면접 플랜 재생성)", () => {
  it("다시 준비를 시작하고 화면을 다시 그려(refresh) 진행률 조회를 이어 간다", async () => {
    post.mockResolvedValue({ data: { ...session, planStatus: "GENERATING", planProgress: 0 } });

    expect(await retryPlan(55)).toEqual({});
    expect(post).toHaveBeenCalledWith("/interview-sessions/55/plan/retry");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("이미 다시 준비 중이거나 끝났으면(409 PLAN_NOT_FAILED) 실패로 보지 않고 다시 그리기만 한다", async () => {
    post.mockRejectedValue(
      axiosProblem({
        title: "Conflict",
        status: 409,
        detail: "면접 준비가 실패한 상태가 아니에요.",
        instance: "/api/v1/interview-sessions/55/plan/retry",
        code: "PLAN_NOT_FAILED",
      }),
    );

    expect(await retryPlan(55)).toEqual({});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("면접이 없으면(404 SESSION_NOT_FOUND) S03으로 보낸다", async () => {
    post.mockRejectedValue(axiosProblem(SESSION_NOT_FOUND));

    await expect(retryPlan(55)).rejects.toThrow("REDIRECT /practice");
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려주고 다시 그리지 않는다", async () => {
    post.mockRejectedValue(new Error("network"));

    expect(await retryPlan(55)).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("api가 401로 재발급 · 로그아웃 화면에 보내면(redirect) 그대로 이동한다", async () => {
    const signedOut = new RedirectSignal("REDIRECT /api/auth/signed-out");
    post.mockRejectedValue(signedOut);

    await expect(retryPlan(55)).rejects.toBe(signedOut);
  });

  it.each([0, -1, 1.5])("면접 id가 %s면 서버에 보내지 않는다", async (id) => {
    expect(await retryPlan(id)).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("startSession (5.4 면접 시작)", () => {
  it("멱등 키와 함께 면접을 시작하고 S06 면접 화면으로 간다", async () => {
    post.mockResolvedValue({ data: { ...session, status: "IN_PROGRESS", planStatus: "READY" } });

    await expect(startSession(55, KEY)).rejects.toThrow("REDIRECT /interview/55");
    expect(post).toHaveBeenCalledWith("/interview-sessions/55/start", undefined, {
      headers: { "Idempotency-Key": KEY } satisfies IdempotencyHeaders,
    });
  });

  it("409 PLAN_NOT_READY면 서버 문구를 돌려주고, 화면을 다시 그려 진행률 조회(5.2)를 다시 잇는다", async () => {
    post.mockRejectedValue(
      axiosProblem({
        title: "Conflict",
        status: 409,
        detail: "면접관이 질문을 준비하고 있어요.",
        instance: "/api/v1/interview-sessions/55/start",
        code: "PLAN_NOT_READY",
      }),
    );

    expect(await startSession(55, KEY)).toEqual({ formError: "면접관이 질문을 준비하고 있어요." });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("이미 시작 · 종료한 면접이면(409 INVALID_SESSION_STATE) 서버 문구를 돌려준다", async () => {
    post.mockRejectedValue(
      axiosProblem({
        title: "Conflict",
        status: 409,
        detail: "지금은 할 수 없는 요청이에요.",
        instance: "/api/v1/interview-sessions/55/start",
        code: "INVALID_SESSION_STATE",
      }),
    );

    expect(await startSession(55, KEY)).toEqual({ formError: "지금은 할 수 없는 요청이에요." });
  });

  it("같은 키를 다른 요청에 썼으면(409 IDEMPOTENCY_KEY_REUSED) 새 키가 필요하다고 알린다", async () => {
    post.mockRejectedValue(
      axiosProblem({
        title: "Conflict",
        status: 409,
        detail: "이미 처리된 요청이에요.",
        instance: "/api/v1/interview-sessions/55/start",
        code: "IDEMPOTENCY_KEY_REUSED",
      }),
    );

    expect(await startSession(55, KEY)).toEqual({
      formError: "이미 처리된 요청이에요.",
      keyReused: true,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려주고 다시 그리지 않는다", async () => {
    post.mockRejectedValue(new Error("network"));

    expect(await startSession(55, KEY)).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("면접이 없으면(404 SESSION_NOT_FOUND) S03으로 보낸다", async () => {
    post.mockRejectedValue(axiosProblem(SESSION_NOT_FOUND));

    await expect(startSession(55, KEY)).rejects.toThrow("REDIRECT /practice");
  });

  it("api가 401로 재발급 · 로그아웃 화면에 보내면(redirect) 그대로 이동한다", async () => {
    const signedOut = new RedirectSignal("REDIRECT /api/auth/signed-out");
    post.mockRejectedValue(signedOut);

    await expect(startSession(55, KEY)).rejects.toBe(signedOut);
  });

  it.each([
    { label: "양수가 아닌 면접 id", id: 0, key: KEY },
    { label: "UUID가 아닌 멱등 키", id: 55, key: "not-a-uuid" },
  ])("$label은 서버에 보내지 않는다", async ({ id, key }) => {
    expect(await startSession(id, key)).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("issueSttToken (5.10 실시간 음성 인식 토큰)", () => {
  it("임시 키와 연결 시작 기한을 반환한다", async () => {
    // Swagger 5.10 200 예시
    post.mockResolvedValue({ data: { token: "…", expiresAt: "2026-10-15T12:16:00+09:00" } });

    expect(await issueSttToken(55)).toEqual({
      ok: true,
      token: "…",
      expiresAt: "2026-10-15T12:16:00+09:00",
    });
    // 5.10은 본문 · Idempotency-Key가 없다.
    expect(post).toHaveBeenCalledWith("/interview-sessions/55/stt-token");
  });

  // Swagger 5.10 오류 예시 · API 명세 1장 공통 오류(400 · 500)
  it.each([
    {
      title: "Bad Request",
      status: 400,
      detail: "입력값을 확인해 주세요.",
      instance: "/api/v1/interview-sessions/55/stt-token",
      code: "VALIDATION_FAILED",
    },
    SESSION_NOT_FOUND,
    {
      title: "Conflict",
      status: 409,
      detail: "지금은 할 수 없는 요청이에요.",
      instance: "/api/v1/interview-sessions/55/stt-token",
      code: "INVALID_SESSION_STATE",
    },
    {
      title: "Internal Server Error",
      status: 500,
      detail: "잠시 후 다시 시도해 주세요.",
      instance: "/api/v1/interview-sessions/55/stt-token",
      code: "INTERNAL_ERROR",
    },
    {
      title: "Service Unavailable",
      status: 503,
      detail: "음성 인식을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      instance: "/api/v1/interview-sessions/55/stt-token",
      code: "STT_UNAVAILABLE",
    },
  ] satisfies ProblemDetail[])("$code($status)면 code와 status를 돌려준다", async (problem) => {
    post.mockRejectedValue(axiosProblem(problem));

    expect(await issueSttToken(55)).toEqual({
      ok: false,
      code: problem.code,
      status: problem.status,
    });
  });

  it("본문 없는 502(Nginx)면 code 없이 status만 반환한다", async () => {
    post.mockRejectedValue(axiosStatusOnly(502));

    expect(await issueSttToken(55)).toEqual({ ok: false, code: null, status: 502 });
  });

  it("응답이 전혀 없으면(연결 거부 · 시간 초과) code · status 모두 null", async () => {
    post.mockRejectedValue(axiosNoResponse());

    expect(await issueSttToken(55)).toEqual({ ok: false, code: null, status: null });
  });

  it("api가 401로 재발급 · 로그아웃 화면으로 이동시키면(redirect) 그대로 이동한다", async () => {
    const signedOut = new RedirectSignal("REDIRECT /api/auth/signed-out");
    post.mockRejectedValue(signedOut);

    await expect(issueSttToken(55)).rejects.toBe(signedOut);
  });

  it.each([0, -1, 1.5])("면접 id가 %s면 서버에 보내지 않고 code · status 모두 null", async (id) => {
    expect(await issueSttToken(id)).toEqual({ ok: false, code: null, status: null });
    expect(post).not.toHaveBeenCalled();
  });
});
