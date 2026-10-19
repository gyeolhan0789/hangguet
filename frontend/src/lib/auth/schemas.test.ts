import { describe, expect, it } from "vitest";

import { loginSchema, PASSWORD_RULES, signupSchema } from "./schemas";

const validSignup = {
  nickname: "  면접왕  ",
  email: " a@ssafy.com ",
  password: "abcd1234",
  passwordConfirm: "abcd1234",
  agreements: { TERMS: true, PRIVACY: true, RECORDING: true },
};

const firstError = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues[0]?.path.join(".");

describe("loginSchema", () => {
  it("이메일 형식이 틀리면 막는다", () => {
    const result = loginSchema.safeParse({ email: "a@", password: "x" });
    expect(firstError(result)).toBe("email");
  });

  it("비밀번호가 비면 막는다", () => {
    const result = loginSchema.safeParse({ email: "a@ssafy.com", password: "" });
    expect(firstError(result)).toBe("password");
  });
});

describe("signupSchema", () => {
  it("조건을 모두 만족하면 앞뒤 공백을 지운 값을 돌려준다", () => {
    const result = signupSchema.parse(validSignup);
    expect(result.nickname).toBe("면접왕");
    expect(result.email).toBe("a@ssafy.com");
  });

  it.each([
    ["8자 미만", "abc123"],
    ["숫자 없음", "abcdefgh"],
    ["영문 없음", "12345678"],
    ["64자 초과", `a1${"x".repeat(63)}`],
  ])("비밀번호 %s면 막는다", (_, password) => {
    const result = signupSchema.safeParse({ ...validSignup, password, passwordConfirm: password });
    expect(firstError(result)).toBe("password");
  });

  it("비밀번호 확인이 다르면 확인 칸 오류로 막는다", () => {
    const result = signupSchema.safeParse({ ...validSignup, passwordConfirm: "abcd12345" });
    expect(firstError(result)).toBe("passwordConfirm");
  });

  it("녹화 동의를 포함한 필수 약관 3개 중 하나라도 빠지면 막는다", () => {
    const result = signupSchema.safeParse({
      ...validSignup,
      agreements: { TERMS: true, PRIVACY: true, RECORDING: false },
    });
    expect(firstError(result)).toBe("agreements.RECORDING");
  });
});

describe("PASSWORD_RULES", () => {
  it("규칙 칩마다 통과 여부를 따로 계산한다", () => {
    expect(PASSWORD_RULES.map((rule) => rule.test("abcdefgh"))).toEqual([true, false]);
    expect(PASSWORD_RULES.map((rule) => rule.test("ab1"))).toEqual([false, true]);
  });
});
