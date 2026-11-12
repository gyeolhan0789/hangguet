// @vitest-environment node
// 기준: 웹 Swagger 6.3 면접 결과 · 6.4 다시보기(200 · 404 SESSION_NOT_FOUND · 409 RESULT_NOT_READY · 409 NO_RESULT)
// · RESULT_NOT_READY면 S06-1 분석 중 화면으로
import { describe, expect, it, vi } from "vitest";

import { axiosProblem, axiosStatusOnly } from "@/test/axios-problem";
import { RESULT } from "@/test/result-examples";

import { getResult } from "./queries";

// 경계 mock: HTTP(api)
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));

// 예시 데이터: Swagger 6.3 실패 예시
const SESSION_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "면접을 찾을 수 없어요.",
  instance: "/api/v1/interview-sessions/0",
  code: "SESSION_NOT_FOUND",
};
const RESULT_NOT_READY = {
  title: "Conflict",
  status: 409,
  detail: "결과를 만들고 있어요.",
  instance: "/api/v1/interview-sessions/55/result",
  code: "RESULT_NOT_READY",
};
const NO_RESULT = {
  title: "Conflict",
  status: 409,
  detail: "답변 없이 끝난 면접은 결과가 없어요.",
  instance: "/api/v1/interview-sessions/55/result",
  code: "NO_RESULT",
};

describe("getResult · 6.3 면접 결과 불러오기", () => {
  describe("정상 처리", () => {
    it("결과를 받으면 ok 상태로 데이터를 감싸 돌려준다", async () => {
      api.get.mockResolvedValue({ data: RESULT });

      expect(await getResult(55)).toEqual({ status: "ok", data: RESULT });
    });
  });

  describe("오류 처리", () => {
    it("분석 중이면(409 RESULT_NOT_READY) analyzing을 돌려준다", async () => {
      api.get.mockRejectedValue(axiosProblem(RESULT_NOT_READY));

      expect(await getResult(55)).toEqual({ status: "analyzing" });
    });

    it.each([
      { label: "면접 없음(404 SESSION_NOT_FOUND)", problem: SESSION_NOT_FOUND },
      { label: "결과 없음(409 NO_RESULT)", problem: NO_RESULT },
    ])("'$label'이면 missing을 돌려준다", async ({ problem }) => {
      api.get.mockRejectedValue(axiosProblem(problem));

      expect(await getResult(55)).toEqual({ status: "missing" });
    });

    it("그 밖의 실패(문구 없는 502)면 오류를 그대로 던진다", async () => {
      const error = axiosStatusOnly(502);
      api.get.mockRejectedValue(error);

      await expect(getResult(55)).rejects.toBe(error);
    });
  });
});
