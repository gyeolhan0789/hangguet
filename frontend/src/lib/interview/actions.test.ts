// @vitest-environment node
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { redirectTo } from "@/test/redirect";

import { axiosNoResponse, axiosProblem, axiosStatusOnly } from "@/test/axios-problem";
import type {
  AnswerRequest,
  AnswerResponse,
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

const { createSession, endSession, issueRoomToken, retryPlan, startSession, submitTextAnswer } =
  await import("./actions");

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
  room: null,
} satisfies SessionResponse;

beforeEach(() => {
  vi.clearAllMocks();
  // 앞 테스트의 응답 구현까지 비운다(clearAllMocks는 호출 기록만 지운다).
  post.mockReset();
});

describe("issueRoomToken (5.14 면접방 입장)", () => {
  it("서버 API로 입장 정보를 받아 클라이언트에 필요한 필드만 반환한다", async () => {
    const room = {
      url: "wss://room.test",
      token: "room-only",
      expiresAt: "2026-10-23T15:00:00+09:00",
    };
    post.mockResolvedValue({ data: room });
    expect(await issueRoomToken(55)).toEqual({ ok: true, ...room });
    expect(post).toHaveBeenCalledWith("/interview-sessions/55/room-token");
  });

  it("잘못된 id는 API에 보내지 않는다", async () => {
    expect(await issueRoomToken(0)).toEqual({ ok: false, code: null, status: null });
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    [404, "SESSION_NOT_FOUND"],
    [409, "INVALID_SESSION_STATE"],
  ] as const)("%i 오류 코드를 보존한다", async (status, code) => {
    post.mockRejectedValue(axiosProblem({ status, code, title: "오류", instance: "/room-token" }));
    expect(await issueRoomToken(55)).toEqual({ ok: false, status, code });
  });

  it("인증 redirect 신호를 실패 결과로 바꾸지 않는다", async () => {
    const signal = new RedirectSignal("sign in");
    post.mockRejectedValue(signal);
    await expect(issueRoomToken(55)).rejects.toBe(signal);
  });
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
      redirectTo("/interview/55"),
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

    await expect(createSession(values, KEY)).rejects.toThrow(redirectTo("/practice"));
  });

  it("같은 키를 다른 요청에 썼으면(409 IDEMPOTENCY_KEY_REUSED) 서버 문구와 함께 새 키가 필요하다고 알린다(keySpent)", async () => {
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
      keySpent: true,
    });
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    post.mockRejectedValue(axiosNoResponse());

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

  it("이미 다시 준비 중이거나 끝났으면(409 PLAN_NOT_FAILED) 다시 그리고 서버 문구를 돌려준다", async () => {
    post.mockRejectedValue(
      axiosProblem({
        title: "Conflict",
        status: 409,
        detail: "면접 준비가 실패한 상태가 아니에요.",
        instance: "/api/v1/interview-sessions/55/plan/retry",
        code: "PLAN_NOT_FAILED",
      }),
    );

    expect(await retryPlan(55)).toEqual({ formError: "면접 준비가 실패한 상태가 아니에요." });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("면접이 없으면(404 SESSION_NOT_FOUND) S03으로 보낸다", async () => {
    post.mockRejectedValue(axiosProblem(SESSION_NOT_FOUND));

    await expect(retryPlan(55)).rejects.toThrow(redirectTo("/practice"));
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려주고 다시 그리지 않는다", async () => {
    post.mockRejectedValue(axiosNoResponse());

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

    await expect(startSession(55, KEY)).rejects.toThrow(redirectTo("/interview/55"));
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

    expect(await startSession(55, KEY)).toEqual({
      formError: "면접관이 질문을 준비하고 있어요.",
      keySpent: true,
    });
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

    expect(await startSession(55, KEY)).toEqual({
      formError: "지금은 할 수 없는 요청이에요.",
      keySpent: true,
    });
  });

  it("같은 키를 다른 요청에 썼으면(409 IDEMPOTENCY_KEY_REUSED) 새 키가 필요하다고 알린다", async () => {
    post.mockRejectedValue(
      axiosProblem({
        title: "Conflict",
        status: 409,
        detail: "이미 처리된 요청이에요.",
        instance: "/api/v1/interview-sessions",
        code: "IDEMPOTENCY_KEY_REUSED",
      }),
    );

    expect(await startSession(55, KEY)).toEqual({
      formError: "이미 처리된 요청이에요.",
      keySpent: true,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려주고 다시 그리지 않는다", async () => {
    post.mockRejectedValue(axiosNoResponse());

    expect(await startSession(55, KEY)).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("면접이 없으면(404 SESSION_NOT_FOUND) S03으로 보낸다", async () => {
    post.mockRejectedValue(axiosProblem(SESSION_NOT_FOUND));

    await expect(startSession(55, KEY)).rejects.toThrow(redirectTo("/practice"));
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

// Swagger 5.7 · 5.8 409 예시(코드별 문구 · instance 그대로)
const CONFLICT = {
  ANSWER_ALREADY_SUBMITTED: {
    title: "Conflict",
    status: 409,
    detail: "이미 답변한 질문이에요.",
    instance: "/api/v1/interview-sessions/55/questions/303/answer",
    code: "ANSWER_ALREADY_SUBMITTED",
  },
  INVALID_SESSION_STATE: {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  },
  IDEMPOTENCY_KEY_REUSED: {
    title: "Conflict",
    status: 409,
    detail: "이미 처리된 요청이에요.",
    instance: "/api/v1/interview-sessions",
    code: "IDEMPOTENCY_KEY_REUSED",
  },
} satisfies Record<string, ProblemDetail>;

// Swagger 5.7 404 QUESTION_NOT_FOUND 예시
const QUESTION_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "질문을 찾을 수 없어요.",
  instance: "/api/v1/interview-sessions/55/questions/0/answer",
  code: "QUESTION_NOT_FOUND",
} satisfies ProblemDetail;

// Swagger 5.8 예시: 202 'S06-E 답변한 2개까지 → S06-1' · 200 '답변 0개 → 홈'
const ENDED_ANALYZING = {
  ...session,
  status: "ANALYZING",
  planStatus: "READY",
  planProgress: null,
  analysisStep: "ORGANIZING_ANSWERS",
  answeredCount: 2,
  elapsedSeconds: 522,
  startedAt: "2026-10-15T12:00:00+09:00",
  endedAt: "2026-10-15T12:08:42+09:00",
  leveledUp: true,
  room: null,
} satisfies SessionResponse;
const ENDED_ABORTED = {
  ...session,
  status: "ABORTED",
  planStatus: "READY",
  planProgress: null,
  answeredCount: 0,
  elapsedSeconds: 95,
  startedAt: "2026-10-15T12:00:00+09:00",
  endedAt: "2026-10-15T12:01:35+09:00",
  leveledUp: false,
  room: null,
} satisfies SessionResponse;

describe("submitTextAnswer (5.7 답변 제출 · 채팅)", () => {
  // Swagger 5.7 202 예시(id 903 · 질문 303)를 채팅(TEXT)으로 바꾼 것
  const answer = {
    id: 903,
    questionId: 303,
    inputType: "TEXT",
    createdAt: "2026-10-15T12:08:40+09:00",
    isLastQuestion: false,
  } satisfies AnswerResponse;

  it("TEXT 답변을 멱등 키와 함께 내고, 화면을 다시 그려 다음 질문을 기다린다", async () => {
    post.mockResolvedValue({ data: answer });

    expect(await submitTextAnswer(55, 303, { content: "캐시를 바꿨어요" }, KEY)).toEqual({
      isLastQuestion: false,
    });
    expect(post).toHaveBeenCalledWith(
      "/interview-sessions/55/questions/303/answer",
      { inputType: "TEXT", content: "캐시를 바꿨어요" } satisfies AnswerRequest,
      { headers: { "Idempotency-Key": KEY } satisfies IdempotencyHeaders },
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("마지막 질문이었으면 isLastQuestion을 그대로 돌려준다(화면이 5.8을 부른다)", async () => {
    post.mockResolvedValue({ data: { ...answer, isLastQuestion: true } });

    expect(await submitTextAnswer(55, 303, { content: "끝" }, KEY)).toEqual({
      isLastQuestion: true,
    });
  });

  it.each([
    ["", "필수 값입니다."],
    ["   ", "필수 값입니다."],
    ["가".repeat(1001), "채팅 답변은 1~1,000자입니다."],
  ])("답변 %j은 보내지 않고 칸 오류 '%s'", async (content, message) => {
    expect(await submitTextAnswer(55, 303, { content }, KEY)).toEqual({
      fieldErrors: { content: message },
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("1,000자는 보낸다", async () => {
    post.mockResolvedValue({ data: answer });
    await submitTextAnswer(55, 303, { content: "가".repeat(1000) }, KEY);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("400 VALIDATION_FAILED(content)면 서버 문구를 칸 오류로 돌려준다", async () => {
    post.mockRejectedValue(
      axiosProblem({
        title: "Bad Request",
        status: 400,
        detail: "입력값을 확인해 주세요.",
        instance: "/api/v1/interview-sessions/55/questions/303/answer",
        code: "VALIDATION_FAILED",
        errors: [{ field: "content", reason: "채팅 답변은 1~1,000자입니다." }],
      }),
    );

    expect(await submitTextAnswer(55, 303, { content: "답" }, KEY)).toEqual({
      fieldErrors: { content: "채팅 답변은 1~1,000자입니다." },
      keySpent: true,
    });
  });

  it("409 ANSWER_ALREADY_SUBMITTED면 이미 낸 답변이라고 알리고(alreadySubmitted), 화면을 다시 그린다", async () => {
    post.mockRejectedValue(axiosProblem(CONFLICT.ANSWER_ALREADY_SUBMITTED));

    // 화면은 에이전트에 [답변 완료]를 다시 보내 다음 질문으로 넘어간다(API 명세 5.7)
    expect(await submitTextAnswer(55, 303, { content: "답" }, KEY)).toEqual({
      formError: CONFLICT.ANSWER_ALREADY_SUBMITTED.detail,
      keySpent: true,
      alreadySubmitted: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([CONFLICT.INVALID_SESSION_STATE, QUESTION_NOT_FOUND])(
    "$status $code면 서버 문구를 돌려주고, 화면을 다시 그려 지금 상태를 받는다",
    async (problem) => {
      post.mockRejectedValue(axiosProblem(problem));

      expect(await submitTextAnswer(55, 303, { content: "답" }, KEY)).toEqual({
        formError: problem.detail,
        keySpent: true,
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it("같은 키를 다른 답변에 썼으면(409 IDEMPOTENCY_KEY_REUSED) 새 키가 필요하다고 알린다", async () => {
    post.mockRejectedValue(axiosProblem(CONFLICT.IDEMPOTENCY_KEY_REUSED));

    expect(await submitTextAnswer(55, 303, { content: "답" }, KEY)).toEqual({
      formError: "이미 처리된 요청이에요.",
      keySpent: true,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("면접이 없으면(404 SESSION_NOT_FOUND) S03으로 보낸다", async () => {
    post.mockRejectedValue(axiosProblem(SESSION_NOT_FOUND));
    await expect(submitTextAnswer(55, 303, { content: "답" }, KEY)).rejects.toThrow(
      redirectTo("/practice"),
    );
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    post.mockRejectedValue(axiosNoResponse());
    expect(await submitTextAnswer(55, 303, { content: "답" }, KEY)).toEqual({
      formError: "잠시 후 다시 시도해 주세요.",
    });
  });

  it("api가 401로 재발급 · 로그아웃 화면에 보내면(redirect) 그대로 이동한다", async () => {
    const signedOut = new RedirectSignal("REDIRECT /api/auth/signed-out");
    post.mockRejectedValue(signedOut);
    await expect(submitTextAnswer(55, 303, { content: "답" }, KEY)).rejects.toBe(signedOut);
  });

  it.each([
    { label: "양수가 아닌 면접 id", id: 0, question: 303, key: KEY },
    { label: "양수가 아닌 질문 id", id: 55, question: 0, key: KEY },
    { label: "UUID가 아닌 멱등 키", id: 55, question: 303, key: "not-a-uuid" },
  ])("$label은 서버에 보내지 않는다", async ({ id, question, key }) => {
    expect(await submitTextAnswer(id, question, { content: "답" }, key)).toEqual({
      formError: "잠시 후 다시 시도해 주세요.",
    });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("endSession (5.8 면접 끝내기)", () => {
  it("답변이 있으면(202 ANALYZING) 화면을 다시 그려 S06-1로 바꾸고, 레벨업을 돌려준다(화면이 기억)", async () => {
    post.mockResolvedValue({ data: ENDED_ANALYZING });

    expect(await endSession(55, KEY)).toEqual({ leveledUp: true });
    expect(post).toHaveBeenCalledWith("/interview-sessions/55/end", undefined, {
      headers: { "Idempotency-Key": KEY } satisfies IdempotencyHeaders,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("답변 없이 끝났으면(200 ABORTED) 홈으로 간다", async () => {
    post.mockResolvedValue({ data: ENDED_ABORTED });
    await expect(endSession(55, KEY)).rejects.toThrow(redirectTo("/home"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("이미 끝난 면접이면(409 INVALID_SESSION_STATE) 서버 문구를 돌려주고 화면을 다시 그린다", async () => {
    post.mockRejectedValue(axiosProblem(CONFLICT.INVALID_SESSION_STATE));
    expect(await endSession(55, KEY)).toEqual({
      formError: "지금은 할 수 없는 요청이에요.",
      keySpent: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("같은 키를 다른 요청에 썼으면(409 IDEMPOTENCY_KEY_REUSED) 새 키가 필요하다고 알린다", async () => {
    post.mockRejectedValue(axiosProblem(CONFLICT.IDEMPOTENCY_KEY_REUSED));
    expect(await endSession(55, KEY)).toEqual({
      formError: "이미 처리된 요청이에요.",
      keySpent: true,
    });
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려주고 다시 그리지 않는다", async () => {
    post.mockRejectedValue(axiosNoResponse());
    expect(await endSession(55, KEY)).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("면접이 없으면(404 SESSION_NOT_FOUND) S03으로 보낸다", async () => {
    post.mockRejectedValue(axiosProblem(SESSION_NOT_FOUND));
    await expect(endSession(55, KEY)).rejects.toThrow(redirectTo("/practice"));
  });

  it("api가 401로 재발급 · 로그아웃 화면에 보내면(redirect) 그대로 이동한다", async () => {
    const signedOut = new RedirectSignal("REDIRECT /api/auth/signed-out");
    post.mockRejectedValue(signedOut);
    await expect(endSession(55, KEY)).rejects.toBe(signedOut);
  });

  it.each([
    { label: "양수가 아닌 면접 id", id: 0, key: KEY },
    { label: "UUID가 아닌 멱등 키", id: 55, key: "not-a-uuid" },
  ])("$label은 서버에 보내지 않는다", async ({ id, key }) => {
    expect(await endSession(id, key)).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
    expect(post).not.toHaveBeenCalled();
  });
});

// 기준: 웹 Swagger Idempotency-Key("같은 키·같은 본문이면 처음 결과를 그대로 반환") · ProblemDetail(실패는 code로 구분)
// 서버가 ProblemDetail로 답했으면 새 키(keySpent), 응답을 못 받았거나 본문이 ProblemDetail이 아니면 같은 키로 다시 보낸다.
describe("멱등 키를 쓰는 액션(5.1 · 5.4 · 5.7 · 5.8)의 새 키 경계", () => {
  const actions = [
    ["createSession", () => createSession(values, KEY)],
    ["startSession", () => startSession(55, KEY)],
    ["submitTextAnswer", () => submitTextAnswer(55, 303, { content: "답" }, KEY)],
    ["endSession", () => endSession(55, KEY)],
  ] as const;

  it.each(actions)(
    "%s: 500 INTERNAL_ERROR(ProblemDetail)면 서버 문구와 함께 새 키가 필요하다",
    async (_, run) => {
      post.mockRejectedValue(
        axiosProblem({
          status: 500,
          code: "INTERNAL_ERROR",
          detail: "잠시 후 다시 시도해 주세요.",
        }),
      );

      expect(await run()).toEqual({ formError: "잠시 후 다시 시도해 주세요.", keySpent: true });
    },
  );

  it.each(actions)(
    "%s: 본문 없는 502(ProblemDetail 아님)면 같은 키로 다시 보낸다",
    async (_, run) => {
      post.mockRejectedValue(axiosStatusOnly(502));

      expect(await run()).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
    },
  );

  it.each(actions)("%s: 응답을 못 받았으면(연결 오류) 같은 키로 다시 보낸다", async (_, run) => {
    post.mockRejectedValue(axiosNoResponse());

    expect(await run()).toEqual({ formError: "잠시 후 다시 시도해 주세요." });
  });
});
