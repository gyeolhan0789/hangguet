import { z } from "zod";

// 웹 Swagger 1.2 회원가입 · 1.3 로그인의 입력 조건. 폼(클라이언트)과 서버 액션이 같이 쓴다.

export const emailSchema = z
  .string()
  .trim()
  .min(1, "이메일을 입력해 주세요.")
  .max(255, "이메일은 255자까지 쓸 수 있어요.")
  .pipe(z.email("이메일 형식을 확인해 주세요."));

/** 비밀번호 규칙 칩(S01-1). 8~64자, 영문·숫자 각 1자 이상 */
export const PASSWORD_RULES = [
  { label: "8자 이상", test: (value: string) => value.length >= 8 },
  { label: "영문 + 숫자", test: (value: string) => /[A-Za-z]/.test(value) && /\d/.test(value) },
] as const;

export const PASSWORD_MAX = 64;

/** 필수 약관 3개. 서버는 셋 모두 받아야 가입시킨다(AGREEMENT_REQUIRED). */
export const TERMS = [
  { type: "TERMS", label: "[필수] 이용약관" },
  { type: "PRIVACY", label: "[필수] 개인정보 수집 · 이용" },
  { type: "RECORDING", label: "[필수] 면접 녹화 · 음성 이용" },
] as const;

export type TermsType = (typeof TERMS)[number]["type"];

/** 화면에 보여 준 약관 버전. 약관 본문이 확정되면 함께 바꾼다. */
export const TERMS_VERSION = "1.0";

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, "비밀번호를 입력해 주세요.")
    .max(PASSWORD_MAX, `비밀번호는 ${PASSWORD_MAX}자까지 쓸 수 있어요.`),
});

const agreed = z.boolean().refine((value) => value, "필수 약관에 동의해 주세요.");

export const signupSchema = z
  .object({
    nickname: z
      .string()
      .trim()
      .min(1, "닉네임을 입력해 주세요.")
      .max(50, "닉네임은 50자까지 쓸 수 있어요."),
    email: emailSchema,
    password: z
      .string()
      .max(PASSWORD_MAX, `비밀번호는 ${PASSWORD_MAX}자까지 쓸 수 있어요.`)
      .refine(
        (value) => PASSWORD_RULES.every((rule) => rule.test(value)),
        "8~64자, 영문과 숫자를 모두 포함해야 합니다.",
      ),
    passwordConfirm: z.string().min(1, "비밀번호를 한 번 더 입력해 주세요."),
    agreements: z.object({ TERMS: agreed, PRIVACY: agreed, RECORDING: agreed }),
  })
  .refine((values) => values.password === values.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "비밀번호가 일치하지 않아요.",
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type SignupValues = z.infer<typeof signupSchema>;
