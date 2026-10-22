// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axiosProblem } from "@/test/axios-problem";
import { REPLAY, RESULT } from "@/test/result-examples";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { get } }));

const { getReplay, getResult } = await import("./queries");

// 기준: Swagger 6.3 면접 결과 · 6.4 다시보기(200 · 404 SESSION_NOT_FOUND · 409 RESULT_NOT_READY · 409 NO_RESULT 예시)
// · API 명세 6.3(RESULT_NOT_READY면 화면은 S06-1로) · 사용자 결정(2026-10-22: 404 · NO_RESULT는 S03으로)

// Swagger 6.3 · 6.4 실패 예시
const NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "면접을 찾을 수 없어요.",
  instance: "/api/v1/interview-sessions/0",
  code: "SESSION_NOT_FOUND",
};
const NOT_READY = {
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

beforeEach(() => {
  // 앞 테스트의 응답이 새지 않게 구현까지 지운다.
  get.mockReset();
});

describe.each([
  {
    name: "getResult (6.3 면접 결과)",
    load: getResult,
    url: "/interview-sessions/55/result",
    data: RESULT,
  },
  {
    name: "getReplay (6.4 다시보기)",
    load: getReplay,
    url: "/interview-sessions/55/replay",
    data: REPLAY,
  },
])("$name", ({ load, url, data }) => {
  it("결과가 있으면(200) 그대로 돌려준다", async () => {
    get.mockResolvedValue({ data });

    expect(await load(55)).toEqual({ status: "ok", data });
    expect(get).toHaveBeenCalledWith(url);
  });

  it("아직 분석 중이거나 분석 실패(409 RESULT_NOT_READY)면 analyzing", async () => {
    get.mockRejectedValue(axiosProblem(NOT_READY));
    expect(await load(55)).toEqual({ status: "analyzing" });
  });

  it.each([
    ["404 SESSION_NOT_FOUND", NOT_FOUND],
    ["409 NO_RESULT", NO_RESULT],
  ])("%s면 missing", async (_, problem) => {
    get.mockRejectedValue(axiosProblem(problem));
    expect(await load(55)).toEqual({ status: "missing" });
  });

  it.each([
    [
      "알 수 없는 오류 코드(500 INTERNAL_ERROR)",
      axiosProblem({ ...NOT_FOUND, status: 500, code: "INTERNAL_ERROR" }),
    ],
    ["응답 없는 실패", new Error("network")],
  ])("그 밖의 실패(%s)는 그대로 던져 오류 화면에 맡긴다", async (_, error) => {
    get.mockRejectedValue(error);
    await expect(load(55)).rejects.toBe(error);
  });
});
