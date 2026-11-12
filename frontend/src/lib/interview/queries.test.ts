// @vitest-environment node
// 기준: Swagger 5.2 면접 조회(200 · 404 SESSION_NOT_FOUND) · 5.5 지금 질문(200 · 202 QUESTION_GENERATING · 404 · 409)
import { describe, expect, it, vi } from "vitest";

import { axiosProblem, axiosStatusOnly } from "@/test/axios-problem";

import { getCurrentQuestion, getSession } from "./queries";

// 경계 mock: HTTP(api.get)
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));

// 예시 데이터: Swagger 5.2 · 5.5 오류 예시
const SESSION_NOT_FOUND = axiosProblem({
  title: "Not Found",
  status: 404,
  detail: "면접을 찾을 수 없어요.",
  instance: "/interview-sessions/55",
  code: "SESSION_NOT_FOUND",
});
const INVALID_SESSION_STATE = axiosProblem({
  title: "Conflict",
  status: 409,
  detail: "지금은 할 수 없는 요청이에요.",
  instance: "/interview-sessions/55/questions/current",
  code: "INVALID_SESSION_STATE",
});

describe("getSession · 면접 조회", () => {
  describe("오류 처리", () => {
    it("없는 면접이면(404 SESSION_NOT_FOUND) null을 돌려준다", async () => {
      api.get.mockRejectedValue(SESSION_NOT_FOUND);

      expect(await getSession(55)).toBeNull();
    });

    it("그 밖의 실패면 그대로 던져 오류 화면에 맡긴다", async () => {
      const failure = axiosStatusOnly(502);
      api.get.mockRejectedValue(failure);

      await expect(getSession(55)).rejects.toBe(failure);
    });
  });
});

describe("getCurrentQuestion · 지금 질문", () => {
  describe("정상 처리", () => {
    it("200이면 질문 id · 순서 · 내용만 돌려준다", async () => {
      // 예시 데이터: Swagger 5.5 200 예시
      api.get.mockResolvedValue({
        status: 200,
        data: {
          id: 7,
          seq: 3,
          content: "트랜잭션 격리 수준을 설명해 주세요.",
          createdAt: "2026-10-15T12:05:00+09:00",
        },
      });

      expect(await getCurrentQuestion(55)).toEqual({
        id: 7,
        seq: 3,
        content: "트랜잭션 격리 수준을 설명해 주세요.",
      });
    });

    it("다음 질문을 만드는 중(202)이면 null을 돌려준다", async () => {
      api.get.mockResolvedValue({ status: 202, data: { code: "QUESTION_GENERATING" } });

      expect(await getCurrentQuestion(55)).toBeNull();
    });
  });

  describe("오류 처리", () => {
    it.each([
      { label: "404 SESSION_NOT_FOUND", error: SESSION_NOT_FOUND },
      { label: "409 INVALID_SESSION_STATE", error: INVALID_SESSION_STATE },
    ])("'$label'면 null을 돌려준다", async ({ error }) => {
      api.get.mockRejectedValue(error);

      expect(await getCurrentQuestion(55)).toBeNull();
    });

    it("그 밖의 실패면 그대로 던진다", async () => {
      const failure = axiosStatusOnly(502);
      api.get.mockRejectedValue(failure);

      await expect(getCurrentQuestion(55)).rejects.toBe(failure);
    });
  });
});
