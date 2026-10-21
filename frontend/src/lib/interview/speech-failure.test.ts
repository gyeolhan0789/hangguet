// @vitest-environment node
import { describe, expect, it } from "vitest";

import { axiosNoResponse, axiosProblem, axiosStatusOnly } from "@/test/axios-problem";

import { toSpeechActionFailure } from "./speech-failure";

describe("toSpeechActionFailure (음성 토큰 · 답변 서버 액션 공용 실패)", () => {
  it("ProblemDetail이 있으면 code와 status를 함께 담는다", () => {
    const error = axiosProblem({
      title: "Conflict",
      status: 409,
      detail: "지금은 할 수 없는 요청이에요.",
      instance: "/api/v1/interview-sessions/55/stt-token",
      code: "INVALID_SESSION_STATE",
    });
    expect(toSpeechActionFailure(error)).toEqual({
      ok: false,
      code: "INVALID_SESSION_STATE",
      status: 409,
    });
  });

  it("본문 없는 502는 code 없이 status만 담는다", () => {
    expect(toSpeechActionFailure(axiosStatusOnly(502))).toEqual({
      ok: false,
      code: null,
      status: 502,
    });
  });

  it("응답이 아예 없으면 code · status 모두 null", () => {
    expect(toSpeechActionFailure(axiosNoResponse())).toEqual({
      ok: false,
      code: null,
      status: null,
    });
  });

  it("axios 오류가 아니거나 인자 없이 부르면(API를 부르지 않은 실패) code · status 모두 null", () => {
    const empty = { ok: false, code: null, status: null };
    expect(toSpeechActionFailure(new Error("boom"))).toEqual(empty);
    expect(toSpeechActionFailure()).toEqual(empty);
  });
});
