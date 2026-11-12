// @vitest-environment node
// 기준: Swagger 5.1 면접 만들기 · 5.3 면접 플랜 재생성 · 5.4 면접 시작 · 5.7 답변 제출 · 5.8 면접 끝내기 · 5.14 면접방 입장 토큰
// · 기획 메모 S05-1(화상 → 장치 점검 · 채팅 → 바로 면접) · S05 · S06-E
import { describe, expect, it, vi } from "vitest";

import { refresh } from "next/cache";

import { RETRY_LATER } from "@/lib/api/problem-detail";
import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import { RedirectError } from "@/test/next-navigation";
import { redirectTo } from "@/test/redirect";
import type { ProblemDetail, SessionResponse } from "@/types/api";

import {
  createSession,
  endSession,
  issueRoomToken,
  retryPlan,
  startSession,
  submitTextAnswer,
} from "./actions";

// 경계 mock: HTTP(api.post)와 Next 런타임(redirect · unstable_rethrow · refresh). 멱등 헤더(idempotencyHeaders)는 실제로 만든다
const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api,
}));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("next/cache", () => import("@/test/next-cache"));

// 예시 데이터: Swagger 5.1 201 예시(면접 55, 화상)
const KEY = "0f8e2a4c-7b1d-4e3a-9c5f-2d6b8a1e4f70";
const VALUES = { applicationId: 10, persona: "DEVIL", mode: "VIDEO" } as const;
const SESSION: SessionResponse = {
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
};

// 예시 데이터: Swagger 5.1 · 5.3 · 5.4 · 5.7 · 5.8 오류 예시
function problem(status: number, code: string, detail: string, extra: Partial<ProblemDetail> = {}) {
  return axiosProblem({
    title: "Error",
    status,
    detail,
    instance: "/interview-sessions/55",
    code,
    ...extra,
  });
}
const SESSION_NOT_FOUND = problem(404, "SESSION_NOT_FOUND", "면접을 찾을 수 없어요.");
const KEY_REUSED = problem(409, "IDEMPOTENCY_KEY_REUSED", "이미 처리된 요청이에요.");
const INVALID_STATE = problem(409, "INVALID_SESSION_STATE", "지금은 할 수 없는 요청이에요.");
const MOVE_TO_REFRESH = new RedirectError("/api/auth/refresh");

describe("issueRoomToken · 면접방 입장 토큰", () => {
  describe("정상 처리", () => {
    it("토큰을 받으면 ok와 입장 주소 · 토큰을 돌려준다", async () => {
      api.post.mockResolvedValue({
        data: {
          url: "wss://room.test",
          token: "room-token",
          expiresAt: "2026-10-23T15:00:00+09:00",
        },
      });

      expect(await issueRoomToken(55)).toMatchObject({
        ok: true,
        url: "wss://room.test",
        token: "room-token",
      });
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "0", id: 0 },
      { label: "음수", id: -1 },
      { label: "소수", id: 1.5 },
    ])("면접 id가 '$label'이면 요청하지 않고 ok가 false인 결과를 돌려준다", async ({ id }) => {
      expect(await issueRoomToken(id)).toMatchObject({ ok: false });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("경계값", () => {
    it("면접 id가 가장 작은 유효값 1이면 요청한다", async () => {
      api.post.mockResolvedValue({ data: { url: "wss://room.test", token: "room-token" } });

      await issueRoomToken(1);

      expect(api.post).toHaveBeenCalledTimes(1);
    });
  });

  describe("오류 처리", () => {
    it("요청이 실패하면 ok가 false인 결과를 돌려준다", async () => {
      api.post.mockRejectedValue(INVALID_STATE);

      expect(await issueRoomToken(55)).toMatchObject({ ok: false });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      api.post.mockRejectedValue(MOVE_TO_REFRESH);

      await expect(issueRoomToken(55)).rejects.toBe(MOVE_TO_REFRESH);
    });
  });
});

describe("createSession · 면접 만들기", () => {
  describe("정상 처리", () => {
    it("화상을 골랐으면 만든 면접의 장치 점검으로 이동한다", async () => {
      api.post.mockResolvedValue({ data: SESSION });

      await expect(createSession(VALUES, KEY)).rejects.toThrow(
        redirectTo("/practice/devices?sessionId=55"),
      );
    });

    it("채팅을 골랐으면 장치 점검 없이 만든 면접 화면으로 이동한다", async () => {
      // 응답의 방식과 상관없이 고른 방식으로 갈 곳을 정한다(목 서버 5.1은 늘 VIDEO 예시를 준다)
      api.post.mockResolvedValue({ data: SESSION });

      await expect(createSession({ ...VALUES, mode: "CHAT" }, KEY)).rejects.toThrow(
        redirectTo("/interview/55"),
      );
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "지원서 id 0", values: { ...VALUES, applicationId: 0 }, key: KEY },
      { label: "UUID가 아닌 멱등 키", values: VALUES, key: "not-a-uuid" },
    ])(
      "'$label'면 요청하지 않고 '면접 정보를 확인해 주세요.'를 돌려준다",
      async ({ values, key }) => {
        expect(await createSession(values, key)).toEqual({
          formError: "면접 정보를 확인해 주세요.",
        });
        expect(api.post).not.toHaveBeenCalled();
      },
    );
  });

  describe("오류 처리", () => {
    it("그사이 지원서가 없어졌으면(404 APPLICATION_NOT_FOUND) 연습 시작으로 이동한다", async () => {
      api.post.mockRejectedValue(problem(404, "APPLICATION_NOT_FOUND", "지원서를 찾을 수 없어요."));

      await expect(createSession(VALUES, KEY)).rejects.toThrow(redirectTo("/practice"));
    });

    it("서버가 문구와 함께 실패하면(409 IDEMPOTENCY_KEY_REUSED) 그 문구와 새 키가 필요하다는 표시를 돌려준다", async () => {
      api.post.mockRejectedValue(KEY_REUSED);

      expect(await createSession(VALUES, KEY)).toEqual({
        formError: "이미 처리된 요청이에요.",
        keySpent: true,
      });
    });

    it("서버 문구 없이 실패하면 다시 시도 안내만 돌려주고 같은 키를 다시 쓰게 한다", async () => {
      api.post.mockRejectedValue(axiosNoResponse());

      expect(await createSession(VALUES, KEY)).toEqual({ formError: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      api.post.mockRejectedValue(MOVE_TO_REFRESH);

      await expect(createSession(VALUES, KEY)).rejects.toBe(MOVE_TO_REFRESH);
    });
  });
});

describe("retryPlan · 질문 준비 다시 시작", () => {
  describe("정상 처리", () => {
    it("다시 시작하면 빈 결과를 돌려주고 화면을 다시 그린다", async () => {
      api.post.mockResolvedValue({ data: SESSION });

      expect(await retryPlan(55)).toEqual({});
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "0", id: 0 },
      { label: "음수", id: -1 },
      { label: "소수", id: 1.5 },
    ])("면접 id가 '$label'이면 요청하지 않고 다시 시도 안내를 돌려준다", async ({ id }) => {
      expect(await retryPlan(id)).toEqual({ formError: RETRY_LATER });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("이미 다시 준비 중이거나 끝났으면(409 PLAN_NOT_FAILED) 화면을 다시 그리고 서버 문구를 돌려준다", async () => {
      api.post.mockRejectedValue(
        problem(409, "PLAN_NOT_FAILED", "면접 준비가 실패한 상태가 아니에요."),
      );

      expect(await retryPlan(55)).toEqual({ formError: "면접 준비가 실패한 상태가 아니에요." });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("면접이 없으면(404 SESSION_NOT_FOUND) 연습 시작으로 이동한다", async () => {
      api.post.mockRejectedValue(SESSION_NOT_FOUND);

      await expect(retryPlan(55)).rejects.toThrow(redirectTo("/practice"));
    });

    it("그 밖의 서버 실패(500)면 서버 문구를 돌려주고 다시 그리지 않는다", async () => {
      // 예시 detail은 대체 문구(RETRY_LATER)와 같으면 detail 경로를 지워도 통과하므로 다른 문구로 정했다
      api.post.mockRejectedValue(
        problem(500, "INTERNAL_SERVER_ERROR", "서버에 일시적인 문제가 생겼어요."),
      );

      expect(await retryPlan(55)).toEqual({ formError: "서버에 일시적인 문제가 생겼어요." });
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      api.post.mockRejectedValue(MOVE_TO_REFRESH);

      await expect(retryPlan(55)).rejects.toBe(MOVE_TO_REFRESH);
    });
  });
});

describe("startSession · 면접 시작", () => {
  describe("정상 처리", () => {
    it("시작하면 면접 화면으로 이동한다", async () => {
      api.post.mockResolvedValue({ data: { ...SESSION, status: "IN_PROGRESS" } });

      await expect(startSession(55, KEY)).rejects.toThrow(redirectTo("/interview/55"));
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "면접 id 0", id: 0, key: KEY },
      { label: "UUID가 아닌 멱등 키", id: 55, key: "not-a-uuid" },
    ])("'$label'면 요청하지 않고 다시 시도 안내를 돌려준다", async ({ id, key }) => {
      expect(await startSession(id, key)).toEqual({ formError: RETRY_LATER });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("질문 준비가 아직이면(409 PLAN_NOT_READY) 화면을 다시 그리고 서버 문구와 새 키 표시를 돌려준다", async () => {
      api.post.mockRejectedValue(
        problem(409, "PLAN_NOT_READY", "면접관이 질문을 준비하고 있어요."),
      );

      expect(await startSession(55, KEY)).toEqual({
        formError: "면접관이 질문을 준비하고 있어요.",
        keySpent: true,
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("이미 시작했거나 끝난 면접이면(409 INVALID_SESSION_STATE) 서버 문구와 새 키 표시를 돌려주고 다시 그리지 않는다", async () => {
      api.post.mockRejectedValue(INVALID_STATE);

      expect(await startSession(55, KEY)).toEqual({
        formError: "지금은 할 수 없는 요청이에요.",
        keySpent: true,
      });
      expect(refresh).not.toHaveBeenCalled();
    });

    it("면접이 없으면(404 SESSION_NOT_FOUND) 연습 시작으로 이동한다", async () => {
      api.post.mockRejectedValue(SESSION_NOT_FOUND);

      await expect(startSession(55, KEY)).rejects.toThrow(redirectTo("/practice"));
    });

    it("서버 문구 없이 실패하면 다시 시도 안내만 돌려주고 같은 키를 다시 쓰게 한다", async () => {
      api.post.mockRejectedValue(axiosNoResponse());

      expect(await startSession(55, KEY)).toEqual({ formError: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      api.post.mockRejectedValue(MOVE_TO_REFRESH);

      await expect(startSession(55, KEY)).rejects.toBe(MOVE_TO_REFRESH);
    });
  });
});

describe("submitTextAnswer · 채팅 답변 제출", () => {
  const ANSWER = { content: "트랜잭션 격리 수준을 낮춰 해결했습니다." };

  describe("정상 처리", () => {
    it("답변을 내면 화면을 다시 그리고 마지막 질문인지를 돌려준다", async () => {
      // 예시 데이터: Swagger 5.7 202 예시
      api.post.mockResolvedValue({
        data: {
          id: 301,
          questionId: 7,
          inputType: "TEXT",
          createdAt: "2026-10-15T12:10:00+09:00",
          isLastQuestion: true,
        },
      });

      expect(await submitTextAnswer(55, 7, ANSWER, KEY)).toEqual({ isLastQuestion: true });
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "빈 글", content: "" },
      { label: "공백만", content: "   " },
    ])("'$label'이면 요청하지 않고 칸 오류 '필수 값입니다.'를 돌려준다", async ({ content }) => {
      expect(await submitTextAnswer(55, 7, { content }, KEY)).toEqual({
        fieldErrors: { content: "필수 값입니다." },
      });
      expect(api.post).not.toHaveBeenCalled();
    });

    it("1,001자면 요청하지 않고 칸 오류 '채팅 답변은 1~1,000자입니다.'를 돌려준다", async () => {
      expect(await submitTextAnswer(55, 7, { content: "가".repeat(1001) }, KEY)).toEqual({
        fieldErrors: { content: "채팅 답변은 1~1,000자입니다." },
      });
      expect(api.post).not.toHaveBeenCalled();
    });

    it.each([
      { label: "면접 id", sessionId: 0, questionId: 7, key: KEY },
      { label: "질문 id", sessionId: 55, questionId: 0, key: KEY },
      { label: "멱등 키", sessionId: 55, questionId: 7, key: "not-a-uuid" },
    ])(
      "'$label'가 잘못되면 요청하지 않고 다시 시도 안내를 돌려준다",
      async ({ sessionId, questionId, key }) => {
        expect(await submitTextAnswer(sessionId, questionId, ANSWER, key)).toEqual({
          formError: RETRY_LATER,
        });
        expect(api.post).not.toHaveBeenCalled();
      },
    );
  });

  describe("경계값", () => {
    it("1,000자면 요청한다", async () => {
      api.post.mockResolvedValue({ data: { isLastQuestion: false } });

      await submitTextAnswer(55, 7, { content: "가".repeat(1000) }, KEY);

      expect(api.post).toHaveBeenCalledTimes(1);
    });
  });

  describe("오류 처리", () => {
    it("서버가 답변 칸을 거절하면(400 VALIDATION_FAILED) 그 사유를 칸 오류로 돌려주고 새 키 표시를 붙인다", async () => {
      api.post.mockRejectedValue(
        problem(400, "VALIDATION_FAILED", "입력값을 확인해 주세요.", {
          errors: [{ field: "content", reason: "채팅 답변은 1~1,000자입니다." }],
        }),
      );

      expect(await submitTextAnswer(55, 7, ANSWER, KEY)).toEqual({
        fieldErrors: { content: "채팅 답변은 1~1,000자입니다." },
        keySpent: true,
      });
    });

    it("이미 낸 답변이면(409 ANSWER_ALREADY_SUBMITTED) 화면을 다시 그리고 이미 냈다는 표시와 새 키 표시를 돌려준다", async () => {
      api.post.mockRejectedValue(
        problem(409, "ANSWER_ALREADY_SUBMITTED", "이미 답변한 질문이에요."),
      );

      expect(await submitTextAnswer(55, 7, ANSWER, KEY)).toEqual({
        formError: "이미 답변한 질문이에요.",
        keySpent: true,
        alreadySubmitted: true,
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it.each([
      {
        label: "409 INVALID_SESSION_STATE",
        error: INVALID_STATE,
        detail: "지금은 할 수 없는 요청이에요.",
      },
      {
        label: "404 QUESTION_NOT_FOUND",
        error: problem(404, "QUESTION_NOT_FOUND", "질문을 찾을 수 없어요."),
        detail: "질문을 찾을 수 없어요.",
      },
    ])(
      "'$label'면 화면을 다시 그리고 이미 냈다는 표시 없이 서버 문구를 돌려준다",
      async ({ error, detail }) => {
        api.post.mockRejectedValue(error);

        expect(await submitTextAnswer(55, 7, ANSWER, KEY)).toEqual({
          formError: detail,
          keySpent: true,
        });
        expect(refresh).toHaveBeenCalledTimes(1);
      },
    );

    it("면접이 없으면(404 SESSION_NOT_FOUND) 연습 시작으로 이동한다", async () => {
      api.post.mockRejectedValue(SESSION_NOT_FOUND);

      await expect(submitTextAnswer(55, 7, ANSWER, KEY)).rejects.toThrow(redirectTo("/practice"));
    });

    it("같은 키를 다른 답변에 썼으면(409 IDEMPOTENCY_KEY_REUSED) 서버 문구와 새 키 표시를 돌려주고 다시 그리지 않는다", async () => {
      api.post.mockRejectedValue(KEY_REUSED);

      expect(await submitTextAnswer(55, 7, ANSWER, KEY)).toEqual({
        formError: "이미 처리된 요청이에요.",
        keySpent: true,
      });
      expect(refresh).not.toHaveBeenCalled();
    });

    it("서버 문구 없이 실패하면 다시 시도 안내만 돌려주고 같은 키를 다시 쓰게 한다", async () => {
      api.post.mockRejectedValue(axiosNoResponse());

      expect(await submitTextAnswer(55, 7, ANSWER, KEY)).toEqual({ formError: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      api.post.mockRejectedValue(MOVE_TO_REFRESH);

      await expect(submitTextAnswer(55, 7, ANSWER, KEY)).rejects.toBe(MOVE_TO_REFRESH);
    });
  });
});

describe("endSession · 면접 끝내기", () => {
  /** endSession이 보낸 본문(FE가 시선 비율로 계산한 값) */
  const sentBody = () => api.post.mock.calls[0][1];

  describe("정상 처리", () => {
    it("답한 면접을 끝내면(202 ANALYZING) 화면을 다시 그리고 레벨업 여부를 돌려준다", async () => {
      api.post.mockResolvedValue({ data: { ...SESSION, status: "ANALYZING", leveledUp: true } });

      expect(await endSession(55, KEY)).toEqual({ leveledUp: true });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("답 없이 끝났으면(200 ABORTED) 다시 그리지 않고 홈으로 이동한다", async () => {
      api.post.mockResolvedValue({ data: { ...SESSION, status: "ABORTED" } });

      await expect(endSession(55, KEY)).rejects.toThrow(redirectTo("/home"));
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "면접 id 0", id: 0, key: KEY },
      { label: "UUID가 아닌 멱등 키", id: 55, key: "not-a-uuid" },
    ])("'$label'면 요청하지 않고 다시 시도 안내를 돌려준다", async ({ id, key }) => {
      expect(await endSession(id, key)).toEqual({ formError: RETRY_LATER });
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "0", gazeRatio: 0 },
      { label: "100", gazeRatio: 100 },
    ])("시선 비율이 '$label'이면 본문에 싣는다", async ({ gazeRatio }) => {
      api.post.mockResolvedValue({ data: { ...SESSION, status: "ANALYZING", leveledUp: false } });

      await endSession(55, KEY, gazeRatio);

      expect(sentBody()).toEqual({ gazeRatio });
    });

    it.each([
      { label: "null", gazeRatio: null },
      { label: "없음", gazeRatio: undefined },
      { label: "-0.01", gazeRatio: -0.01 },
      { label: "100.01", gazeRatio: 100.01 },
    ])("시선 비율이 '$label'이면 본문 없이 보낸다", async ({ gazeRatio }) => {
      api.post.mockResolvedValue({ data: { ...SESSION, status: "ANALYZING", leveledUp: false } });

      await endSession(55, KEY, gazeRatio);

      expect(sentBody()).toBeUndefined();
    });
  });

  describe("오류 처리", () => {
    it("이미 끝난 면접이면(409 INVALID_SESSION_STATE) 화면을 다시 그리고 서버 문구와 새 키 표시를 돌려준다", async () => {
      api.post.mockRejectedValue(INVALID_STATE);

      expect(await endSession(55, KEY)).toEqual({
        formError: "지금은 할 수 없는 요청이에요.",
        keySpent: true,
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("면접이 없으면(404 SESSION_NOT_FOUND) 연습 시작으로 이동한다", async () => {
      api.post.mockRejectedValue(SESSION_NOT_FOUND);

      await expect(endSession(55, KEY)).rejects.toThrow(redirectTo("/practice"));
    });

    it("같은 키를 다른 요청에 썼으면(409 IDEMPOTENCY_KEY_REUSED) 서버 문구와 새 키 표시를 돌려주고 다시 그리지 않는다", async () => {
      api.post.mockRejectedValue(KEY_REUSED);

      expect(await endSession(55, KEY)).toEqual({
        formError: "이미 처리된 요청이에요.",
        keySpent: true,
      });
      expect(refresh).not.toHaveBeenCalled();
    });

    it("서버 문구 없이 실패하면 다시 시도 안내만 돌려주고 같은 키를 다시 쓰게 한다", async () => {
      api.post.mockRejectedValue(axiosNoResponse());

      expect(await endSession(55, KEY)).toEqual({ formError: RETRY_LATER });
    });
  });

  describe("권한 · 로그인", () => {
    it("이동해야 하면 그 이동을 그대로 던진다", async () => {
      api.post.mockRejectedValue(MOVE_TO_REFRESH);

      await expect(endSession(55, KEY)).rejects.toBe(MOVE_TO_REFRESH);
    });
  });
});
