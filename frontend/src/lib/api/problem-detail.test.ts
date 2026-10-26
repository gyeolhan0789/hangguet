// @vitest-environment node
import { describe, expect, it } from "vitest";

import { axiosNoResponse, axiosProblem, axiosStatusOnly } from "@/test/axios-problem";

import { getHttpStatus, getProblemDetail, RETRY_LATER, toFormActionResult } from "./problem-detail";

describe("getHttpStatus", () => {
  it("ProblemDetail로 실패하면 그 응답의 상태 코드를 꺼낸다", () => {
    const error = axiosProblem({
      title: "Conflict",
      status: 409,
      detail: "지금은 할 수 없는 요청이에요.",
      instance: "/api/v1/interview-sessions/55/room-token",
      code: "INVALID_SESSION_STATE",
    });
    expect(getHttpStatus(error)).toBe(409);
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

// 기준: 웹 Swagger ProblemDetail(필수 필드 없음) · "실패하면 응답의 code로 오류를 구분한다"
describe("toFormActionResult", () => {
  it("서버 문구(detail)가 있으면 그 문구를 폼 오류로 쓴다", () => {
    const error = axiosProblem({
      status: 401,
      code: "LOGIN_FAILED",
      detail: "이메일 또는 비밀번호를 확인해 주세요.",
    });
    expect(toFormActionResult(error, ["email"])).toEqual({
      formError: "이메일 또는 비밀번호를 확인해 주세요.",
    });
  });

  it("code만 있고 detail이 없으면 다시 시도 안내를 쓴다", () => {
    expect(
      toFormActionResult(axiosProblem({ status: 500, code: "INTERNAL_ERROR" }), ["email"]),
    ).toEqual({
      formError: RETRY_LATER,
    });
  });

  it("본문이 ProblemDetail이 아니면(본문 없는 502 · code 없는 본문) 다시 시도 안내를 쓴다", () => {
    expect(toFormActionResult(axiosStatusOnly(502), [])).toEqual({ formError: RETRY_LATER });
    expect(toFormActionResult(axiosStatusOnly(500, { detail: "x" }), [])).toEqual({
      formError: RETRY_LATER,
    });
  });
});

describe("getProblemDetail", () => {
  it("본문에 code가 있으면 ProblemDetail로 꺼낸다", () => {
    expect(getProblemDetail(axiosProblem({ code: "LOGIN_FAILED" }))).toEqual({
      code: "LOGIN_FAILED",
    });
  });

  it("본문에 code가 없으면 ProblemDetail로 보지 않는다", () => {
    expect(getProblemDetail(axiosStatusOnly(502))).toBeNull();
    expect(getProblemDetail(axiosStatusOnly(500, { detail: "x" }))).toBeNull();
  });
});
