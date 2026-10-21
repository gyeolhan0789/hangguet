// @vitest-environment node
import { describe, expect, it } from "vitest";

import { axiosNoResponse, axiosProblem, axiosStatusOnly } from "@/test/axios-problem";

import { getHttpStatus } from "./problem-detail";

describe("getHttpStatus", () => {
  it("ProblemDetail로 실패하면 그 응답의 상태 코드를 꺼낸다", () => {
    const error = axiosProblem({
      title: "Service Unavailable",
      status: 503,
      detail: "음성 인식을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      instance: "/api/v1/interview-sessions/55/stt-token",
      code: "STT_UNAVAILABLE",
    });
    expect(getHttpStatus(error)).toBe(503);
  });

  it("본문 없는 502 · 504(Nginx)도 상태 코드를 꺼낸다", () => {
    expect(getHttpStatus(axiosStatusOnly(502))).toBe(502);
    expect(getHttpStatus(axiosStatusOnly(504, "<html>Gateway Timeout</html>"))).toBe(504);
  });

  it("응답이 아예 없으면(연결 거부 · 시간 초과) null", () => {
    expect(getHttpStatus(axiosNoResponse())).toBeNull();
    expect(getHttpStatus(axiosNoResponse("ECONNREFUSED"))).toBeNull();
  });

  it("axios 오류가 아니면 null", () => {
    expect(getHttpStatus(new Error("boom"))).toBeNull();
    expect(getHttpStatus(undefined)).toBeNull();
  });
});
