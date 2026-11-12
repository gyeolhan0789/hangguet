// @vitest-environment node
// 기준: Swagger "실패하면 응답의 code로 오류를 구분한다" · ProblemDetail · 1.2 회원가입 400 VALIDATION_FAILED 예시
import { describe, expect, it } from "vitest";

import { axiosNoResponse, axiosProblem, axiosStatusOnly } from "@/test/axios-problem";

import { getHttpStatus, getProblemDetail, RETRY_LATER, toFormActionResult } from "./problem-detail";

// 예시 데이터: Swagger 1.2 회원가입 409 · 400 예시
const EMAIL_DUPLICATED = {
  title: "Conflict",
  status: 409,
  detail: "이미 사용 중인 이메일이에요.",
  instance: "/api/v1/auth/signup",
  code: "EMAIL_DUPLICATED",
};
const VALIDATION_FAILED = {
  title: "Bad Request",
  status: 400,
  detail: "입력값을 확인해 주세요.",
  instance: "/api/v1/auth/signup",
  code: "VALIDATION_FAILED",
};
const PASSWORD_REASON = "8~64자, 영문과 숫자를 모두 포함해야 합니다.";

const SIGNUP_FIELDS = ["email", "password"] as const;

describe("getProblemDetail · 실패 본문 꺼내기", () => {
  describe("정상 처리", () => {
    it("본문에 code가 있으면 그 본문을 꺼낸다", () => {
      expect(getProblemDetail(axiosProblem(EMAIL_DUPLICATED))).toEqual(EMAIL_DUPLICATED);
    });
  });

  describe("오류 처리", () => {
    it.each([
      { label: "code 없는 본문", error: axiosStatusOnly(500, { title: "Internal Server Error" }) },
      { label: "문자열 본문(502)", error: axiosStatusOnly(502, "<html>Bad Gateway</html>") },
      { label: "응답 없음", error: axiosNoResponse() },
      { label: "axios 오류 아님", error: new Error("fail") },
    ])("실패가 '$label'이면 null을 돌려준다", ({ error }) => {
      expect(getProblemDetail(error)).toBeNull();
    });
  });
});

describe("getHttpStatus · 상태 코드 꺼내기", () => {
  describe("정상 처리", () => {
    it("본문이 ProblemDetail이 아니어도(502) 상태 코드를 꺼낸다", () => {
      expect(getHttpStatus(axiosStatusOnly(502, "<html>Bad Gateway</html>"))).toBe(502);
    });
  });

  describe("오류 처리", () => {
    it.each([
      { label: "응답 없음", error: axiosNoResponse() },
      { label: "axios 오류 아님", error: new Error("fail") },
    ])("실패가 '$label'이면 null을 돌려준다", ({ error }) => {
      expect(getHttpStatus(error)).toBeNull();
    });
  });
});

describe("toFormActionResult · 폼에 보일 실패로 바꾸기", () => {
  describe("서버 문구", () => {
    describe("오류 처리", () => {
      it("서버 문구가 있으면 그 문구를 폼 오류로 쓴다", () => {
        expect(toFormActionResult(axiosProblem(EMAIL_DUPLICATED), SIGNUP_FIELDS)).toEqual({
          formError: "이미 사용 중인 이메일이에요.",
        });
      });

      it("code만 있고 문구가 없으면 다시 시도 안내를 쓴다", () => {
        const withoutDetail = { ...EMAIL_DUPLICATED, detail: undefined };

        expect(toFormActionResult(axiosProblem(withoutDetail), SIGNUP_FIELDS)).toEqual({
          formError: RETRY_LATER,
        });
      });

      it.each([
        { label: "502", error: axiosStatusOnly(502) },
        { label: "응답 없음", error: axiosNoResponse() },
      ])("본문이 ProblemDetail이 아니면('$label') 다시 시도 안내를 쓴다", ({ error }) => {
        expect(toFormActionResult(error, SIGNUP_FIELDS)).toEqual({ formError: RETRY_LATER });
      });
    });
  });

  describe("VALIDATION_FAILED 칸 나누기", () => {
    describe("경계값", () => {
      it("거절된 칸 목록이 비어 있으면 칸 오류 없이 서버 문구를 폼 오류로 쓴다", () => {
        const error = axiosProblem({ ...VALIDATION_FAILED, errors: [] });

        expect(toFormActionResult(error, SIGNUP_FIELDS)).toEqual({
          formError: "입력값을 확인해 주세요.",
        });
      });
    });

    describe("오류 처리", () => {
      it("거절된 칸이 모두 폼에 있으면 칸 오류만 돌려주고 폼 오류는 없다", () => {
        const error = axiosProblem({
          ...VALIDATION_FAILED,
          errors: [{ field: "password", reason: PASSWORD_REASON }],
        });

        expect(toFormActionResult(error, SIGNUP_FIELDS)).toEqual({
          fieldErrors: { password: PASSWORD_REASON },
        });
      });

      it("거절된 칸이 모두 폼 밖이면 칸 오류 없이 서버 문구를 폼 오류로 쓴다", () => {
        const error = axiosProblem({
          ...VALIDATION_FAILED,
          errors: [{ field: "agreements", reason: "필수 약관에 동의해야 합니다." }],
        });

        expect(toFormActionResult(error, SIGNUP_FIELDS)).toEqual({
          formError: "입력값을 확인해 주세요.",
        });
      });

      it("폼 칸과 폼 밖 칸이 섞이면 폼 칸은 칸 오류로, 나머지는 서버 문구를 폼 오류로 보인다", () => {
        const error = axiosProblem({
          ...VALIDATION_FAILED,
          errors: [
            { field: "password", reason: PASSWORD_REASON },
            { field: "agreements", reason: "필수 약관에 동의해야 합니다." },
          ],
        });

        expect(toFormActionResult(error, SIGNUP_FIELDS)).toEqual({
          fieldErrors: { password: PASSWORD_REASON },
          formError: "입력값을 확인해 주세요.",
        });
      });

      it("폼 밖 칸이 있는데 서버 문구가 없으면 다시 시도 안내를 폼 오류로 쓴다", () => {
        const withoutDetail = { ...VALIDATION_FAILED, detail: undefined };
        const error = axiosProblem({
          ...withoutDetail,
          errors: [{ field: "agreements", reason: "필수 약관에 동의해야 합니다." }],
        });

        expect(toFormActionResult(error, SIGNUP_FIELDS)).toEqual({ formError: RETRY_LATER });
      });
    });
  });
});
