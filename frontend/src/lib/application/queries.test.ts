// @vitest-environment node
// 기준: Swagger 4.2 지원서 조회 · 4.6 지원서의 연습 면접 목록(404 APPLICATION_NOT_FOUND · 500 INTERNAL_ERROR)
import { describe, expect, it, vi } from "vitest";

import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";

import { getApplication, getApplicationSessions } from "./queries";

// 경계 mock: HTTP(api)
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));

// 예시 데이터: Swagger 4.2 · 4.6 404 예시와 code만 다른 404
const APPLICATION_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "지원서를 찾을 수 없어요.",
  instance: "/api/v1/applications/0",
  code: "APPLICATION_NOT_FOUND",
};
const OTHER_FAILURES = [
  {
    label: "다른 code의 404",
    error: axiosProblem({ ...APPLICATION_NOT_FOUND, code: "SESSION_NOT_FOUND" }),
  },
  { label: "응답 없음", error: axiosNoResponse() },
];

describe("getApplication · 지원서 조회", () => {
  describe("오류 처리", () => {
    it("지원서가 없으면(404 APPLICATION_NOT_FOUND) null을 돌려준다", async () => {
      api.get.mockRejectedValue(axiosProblem(APPLICATION_NOT_FOUND));

      expect(await getApplication(12)).toBeNull();
    });

    it.each(OTHER_FAILURES)("그 밖의 실패('$label')는 그대로 던진다", async ({ error }) => {
      api.get.mockRejectedValue(error);

      await expect(getApplication(12)).rejects.toBe(error);
    });
  });
});

describe("getApplicationSessions · 지원서의 연습 면접 목록", () => {
  describe("오류 처리", () => {
    it("지원서가 없으면(404 APPLICATION_NOT_FOUND) null을 돌려준다", async () => {
      api.get.mockRejectedValue(axiosProblem(APPLICATION_NOT_FOUND));

      expect(await getApplicationSessions(12, 0, 10)).toBeNull();
    });

    it.each(OTHER_FAILURES)("그 밖의 실패('$label')는 그대로 던진다", async ({ error }) => {
      api.get.mockRejectedValue(error);

      await expect(getApplicationSessions(12, 0, 10)).rejects.toBe(error);
    });
  });
});
