// @vitest-environment node
// 기준: Swagger 1.2 회원가입 · 1.3 로그인 · 1.7 소셜 회원가입 · 1.9 비밀번호 재설정 입력 조건 · Figma S01-1 비밀번호 규칙 칩 · 사용자 결정(2026-10-30 만 14세 확인)
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  emailSchema,
  loginSchema,
  PASSWORD_RULES,
  passwordResetSchema,
  signupSchema,
  socialSignupSchema,
} from "./schemas";

/** 그 칸(path)에 붙은 첫 오류 문구. 통과하면 undefined */
function errorAt(schema: z.ZodType, value: unknown, path = ""): string | undefined {
  const result = schema.safeParse(value);
  return result.error?.issues.find((issue) => issue.path.join(".") === path)?.message;
}

function passes(label: (typeof PASSWORD_RULES)[number]["label"], value: string) {
  return PASSWORD_RULES.find((rule) => rule.label === label)!.test(value);
}

// 예시 데이터: Swagger 1.2 요청 예시(email · password · nickname)와 동의 4개
const SIGNUP = {
  nickname: "면접왕",
  email: "a@ssafy.com",
  password: "abcd1234",
  passwordConfirm: "abcd1234",
  agreements: { AGE: true, TERMS: true, PRIVACY: true, RECORDING: true },
};
const ALL_AGREED = SIGNUP.agreements;

/** 길이가 length인 이메일(@ssafy.com 앞을 늘린다) */
const emailOfLength = (length: number) => `${"a".repeat(length - "@ssafy.com".length)}@ssafy.com`;
/** 영문 · 숫자를 모두 담은 길이 length의 비밀번호 */
const passwordOfLength = (length: number) => `a1${"b".repeat(length - 2)}`;

describe("emailSchema · 이메일 규칙", () => {
  describe("정상 처리", () => {
    it("앞뒤 공백을 지운 이메일을 돌려준다", () => {
      expect(emailSchema.parse("  a@ssafy.com \n")).toBe("a@ssafy.com");
    });
  });

  describe("입력 검증", () => {
    it("비거나 공백뿐이면 '이메일을 입력해 주세요.'로 막는다", () => {
      expect(errorAt(emailSchema, "")).toBe("이메일을 입력해 주세요.");
      expect(errorAt(emailSchema, "   ")).toBe("이메일을 입력해 주세요.");
    });

    it("형식이 틀리면 '이메일 형식을 확인해 주세요.'로 막는다", () => {
      expect(errorAt(emailSchema, "a@ssafy")).toBe("이메일 형식을 확인해 주세요.");
    });
  });

  describe("경계값", () => {
    it.each([
      { length: 255, ok: "통과", error: undefined },
      { length: 256, ok: "255자까지 문구", error: "이메일은 255자까지 쓸 수 있어요." },
    ])("이메일이 '$length'자면 통과 여부는 '$ok'다", ({ length, error }) => {
      expect(errorAt(emailSchema, emailOfLength(length))).toBe(error);
    });
  });
});

describe("PASSWORD_RULES · 비밀번호 규칙 칩", () => {
  describe("입력 검증", () => {
    it.each([
      { label: "영문만", value: "abcdefgh", passed: false },
      { label: "숫자만", value: "12345678", passed: false },
      { label: "둘 다", value: "abcd1234", passed: true },
    ])("비밀번호가 '$label'이면 '영문 + 숫자'는 '$passed'다", ({ value, passed }) => {
      expect(passes("영문 + 숫자", value)).toBe(passed);
    });
  });

  describe("경계값", () => {
    it.each([
      { length: 7, passed: false },
      { length: 8, passed: true },
    ])("비밀번호가 '$length'자면 '8자 이상'은 '$passed'다", ({ length, passed }) => {
      expect(passes("8자 이상", "a".repeat(length))).toBe(passed);
    });
  });
});

describe("loginSchema · 로그인 입력", () => {
  describe("정상 처리", () => {
    it("가입 규칙에 맞지 않는 비밀번호도 로그인에는 받는다", () => {
      expect(loginSchema.safeParse({ email: "a@ssafy.com", password: "abc" }).success).toBe(true);
    });
  });

  describe("입력 검증", () => {
    it("비밀번호가 비면 '비밀번호를 입력해 주세요.'로 막는다", () => {
      expect(errorAt(loginSchema, { email: "a@ssafy.com", password: "" }, "password")).toBe(
        "비밀번호를 입력해 주세요.",
      );
    });
  });

  describe("경계값", () => {
    it.each([
      { length: 64, ok: "통과", error: undefined },
      { length: 65, ok: "64자까지", error: "비밀번호는 64자까지 쓸 수 있어요." },
    ])("비밀번호가 '$length'자면 통과 여부는 '$ok'다", ({ length, error }) => {
      const values = { email: "a@ssafy.com", password: "a".repeat(length) };

      expect(errorAt(loginSchema, values, "password")).toBe(error);
    });
  });
});

describe("signupSchema · 회원가입 입력", () => {
  describe("정상 처리", () => {
    it("조건을 모두 만족하면 닉네임 · 이메일의 앞뒤 공백을 지운 값을 돌려준다", () => {
      expect(
        signupSchema.parse({ ...SIGNUP, nickname: "  면접왕 ", email: " a@ssafy.com " }),
      ).toEqual(SIGNUP);
    });
  });

  describe("입력 검증", () => {
    it("비밀번호가 규칙에 맞지 않으면 서버와 같은 문구로 막는다", () => {
      const values = { ...SIGNUP, password: "abcdefgh", passwordConfirm: "abcdefgh" };

      expect(errorAt(signupSchema, values, "password")).toBe(
        "8~64자, 영문과 숫자를 모두 포함해야 합니다.",
      );
    });

    it("비밀번호 확인이 비면 '비밀번호를 한 번 더 입력해 주세요.'로 막는다", () => {
      expect(errorAt(signupSchema, { ...SIGNUP, passwordConfirm: "" }, "passwordConfirm")).toBe(
        "비밀번호를 한 번 더 입력해 주세요.",
      );
    });

    it("비밀번호 확인이 다르면 확인 칸에 '비밀번호가 일치하지 않아요.'로 막는다", () => {
      expect(
        errorAt(signupSchema, { ...SIGNUP, passwordConfirm: "abcd9999" }, "passwordConfirm"),
      ).toBe("비밀번호가 일치하지 않아요.");
    });

    it("닉네임이 공백뿐이면 '닉네임을 입력해 주세요.'로 막는다", () => {
      expect(errorAt(signupSchema, { ...SIGNUP, nickname: "   " }, "nickname")).toBe(
        "닉네임을 입력해 주세요.",
      );
    });

    it.each([{ type: "AGE" }, { type: "TERMS" }, { type: "PRIVACY" }, { type: "RECORDING" }])(
      "필수 동의 '$type'이 빠지면 '필수 약관에 동의해 주세요.'로 막는다",
      ({ type }) => {
        const values = { ...SIGNUP, agreements: { ...ALL_AGREED, [type]: false } };

        expect(errorAt(signupSchema, values, `agreements.${type}`)).toBe(
          "필수 약관에 동의해 주세요.",
        );
      },
    );
  });

  describe("경계값", () => {
    it.each([
      { length: 50, ok: "통과", error: undefined },
      { length: 51, ok: "50자까지", error: "닉네임은 50자까지 쓸 수 있어요." },
    ])("닉네임이 '$length'자면 통과 여부는 '$ok'다", ({ length, error }) => {
      expect(errorAt(signupSchema, { ...SIGNUP, nickname: "가".repeat(length) }, "nickname")).toBe(
        error,
      );
    });

    it.each([
      { length: 64, ok: "통과", error: undefined },
      { length: 65, ok: "64자까지", error: "비밀번호는 64자까지 쓸 수 있어요." },
    ])("새 비밀번호가 '$length'자면 통과 여부는 '$ok'다", ({ length, error }) => {
      const password = passwordOfLength(length);

      expect(
        errorAt(signupSchema, { ...SIGNUP, password, passwordConfirm: password }, "password"),
      ).toBe(error);
    });
  });
});

describe("passwordResetSchema · 비밀번호 재설정 입력", () => {
  describe("입력 검증", () => {
    it("비밀번호가 규칙에 맞지 않으면 가입과 같은 문구로 막는다", () => {
      const values = { password: "12345678", passwordConfirm: "12345678" };

      expect(errorAt(passwordResetSchema, values, "password")).toBe(
        "8~64자, 영문과 숫자를 모두 포함해야 합니다.",
      );
    });

    it("비밀번호 확인이 다르면 확인 칸 오류로 막는다", () => {
      const values = { password: "abcd1234", passwordConfirm: "abcd9999" };

      expect(errorAt(passwordResetSchema, values, "passwordConfirm")).toBe(
        "비밀번호가 일치하지 않아요.",
      );
    });
  });
});

describe("socialSignupSchema · 카카오 가입 동의", () => {
  describe("정상 처리", () => {
    it("필수 동의 4개를 모두 하면 통과한다", () => {
      expect(socialSignupSchema.safeParse(ALL_AGREED).success).toBe(true);
    });
  });

  describe("입력 검증", () => {
    it.each([{ type: "AGE" }, { type: "TERMS" }, { type: "PRIVACY" }, { type: "RECORDING" }])(
      "필수 동의 '$type'이 빠지면 막는다",
      ({ type }) => {
        expect(errorAt(socialSignupSchema, { ...ALL_AGREED, [type]: false }, type)).toBe(
          "필수 약관에 동의해 주세요.",
        );
      },
    );
  });
});
