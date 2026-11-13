// @vitest-environment node
// 기준: Swagger 공통 오류(500 INTERNAL_ERROR) · 2초마다 다시 부르는 조회(10.4 "2초마다") 중 BE가 잠깐 답하지 못한 경우(Cloudflare 502)
import { describe, expect, it } from "vitest";

import { axiosNoResponse, axiosProblem, axiosStatusOnly } from "@/test/axios-problem";

import { isTemporaryFailure, unlessTemporary } from "./temporary-failure";

describe("isTemporaryFailure · BE가 잠깐 답하지 못함", () => {
  describe("경계값", () => {
    it.each([
      { label: "응답 없음(연결 실패)", error: axiosNoResponse(), temporary: true },
      { label: "502", error: axiosStatusOnly(502), temporary: true },
      { label: "500", error: axiosStatusOnly(500), temporary: true },
      {
        label: "404 GROUP_NOT_FOUND",
        error: axiosProblem({ title: "Not Found", status: 404, code: "GROUP_NOT_FOUND" }),
        temporary: false,
      },
      { label: "499", error: axiosStatusOnly(499), temporary: false },
      { label: "axios 오류가 아님", error: new Error("boom"), temporary: false },
    ])("'$label'이면 잠깐 실패 여부가 $temporary다", ({ error, temporary }) => {
      expect(isTemporaryFailure(error)).toBe(temporary);
    });
  });
});

describe("unlessTemporary · 잠깐 실패를 받지 못함으로 바꾸기", () => {
  describe("정상 처리", () => {
    it("조회가 성공하면 그 값을 돌려준다", async () => {
      expect(await unlessTemporary(Promise.resolve(7))).toBe(7);
    });
  });

  describe("오류 처리", () => {
    it("잠깐 실패하면(502) 던지지 않고 undefined를 돌려준다", async () => {
      expect(await unlessTemporary(Promise.reject(axiosStatusOnly(502)))).toBeUndefined();
    });

    it("그 밖의 실패(403)는 그대로 던진다", async () => {
      const forbidden = axiosStatusOnly(403);

      await expect(unlessTemporary(Promise.reject(forbidden))).rejects.toBe(forbidden);
    });
  });
});
