"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { useForm } from "react-hook-form";

import { Field, PasswordInput, SubmitButton, TextInput } from "@/components/form";
import { login } from "@/lib/auth/actions";
import { loginSchema, type LoginValues } from "@/lib/auth/schemas";
import { ROUTES } from "@/lib/routes";
import { useLoginNoticeStore } from "@/stores/login-notice-store";

import { KakaoButton } from "../../_components/kakao-button";

const errorMessage = (text?: string) => (text ? { text, tone: "error" as const } : undefined);

// 기준: Figma S01 로그인(18:1556: [로그인] 아래 [카카오 로그인]) · 기획 메모 S01-3(423:2140: 카카오 로그인 · 가입 실패는 모달을 닫고
// S01 로그인 버튼 위 오류 문구 자리에, 이메일 로그인 오류와 같은 자리)

export function LoginForm({
  notice,
}: {
  /**
   * 카카오 로그인 · 가입이 실패하고 돌아온 상태를 읽는 자리(page가 쿠키를 읽어 Suspense 안에서 LoginNotice로 넘긴다). 문구는
   * login-notice-store에 담겨 오류 문구 자리에 보인다. 폼은 Suspense 밖에 두어 쿠키를 읽는 동안에도 입력이 사라지지 않는다.
   */
  notice?: ReactNode;
}) {
  // 이메일 로그인 오류와 카카오 실패 문구는 같은 자리라, 같은 store에 담아 마지막에 온 문구 하나만 보인다.
  const formError = useLoginNoticeStore((state) => state.notice);
  const showError = useLoginNoticeStore((state) => state.show);
  const clearError = useLoginNoticeStore((state) => state.clear);

  // 화면을 떠나면 문구를 지운다(다음에 들어왔을 때 다시 뜨지 않게).
  useEffect(() => clearError, [clearError]);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: "onTouched",
    defaultValues: { email: "", password: "" },
  });
  // 한 번 본 화면은 입력값을 살려 다시 보여 주므로(cacheComponents · Activity), 로그아웃한 뒤 다시 와도 지난 이메일 · 비밀번호가
  // 남는다. 화면을 떠날 때 비운다(뒤로 가기로 돌아와도 비밀번호를 남기지 않는다).
  useLayoutEffect(() => () => reset(), [reset]);

  const onSubmit = handleSubmit(async (values) => {
    // 성공하면 서버 액션이 홈으로 보내고, 실패하면 오류를 돌려준다.
    const result = await login(values);
    if (result?.fieldErrors) {
      for (const [field, text] of Object.entries(result.fieldErrors)) {
        if (field === "email" || field === "password") setError(field, { message: text });
      }
    }
    // 실패하면 그 문구로 바꾼다(제출 전에 지우지 않아 옛 문구와 새 문구가 겹쳐 보이지 않는다). 성공하면 홈으로 간다.
    if (result?.formError) showError(result.formError);
    else clearError();
  });

  // [카카오 로그인]은 자기 폼(서버 액션)이라 로그인 폼 밖, [로그인] 바로 아래에 둔다(폼 안에 폼을 넣을 수 없다).
  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-[32px] leading-[1.25] font-extrabold tracking-[-0.5px] text-text-1">
            로그인
          </h1>
          <p className="text-base leading-normal font-medium text-text-2">
            이메일로 로그인하고 스트릭을 이어가세요
          </p>
        </div>

        <Field label="이메일" htmlFor="email" message={errorMessage(errors.email?.message)}>
          <TextInput
            id="email"
            type="email"
            autoComplete="email"
            placeholder="example@ssafy.com"
            invalid={!!errors.email}
            {...register("email")}
          />
        </Field>

        <Field label="비밀번호" htmlFor="password" message={errorMessage(errors.password?.message)}>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="비밀번호를 입력하세요"
            invalid={!!errors.password}
            {...register("password")}
          />
        </Field>
        {/* 기준: 사용자 결정(2026-11-08: 비밀번호 칸 바로 아래 오른쪽) · Figma [보류] S01-2 비밀번호 찾기 */}
        <Link
          href={ROUTES.forgotPassword}
          className="-mt-3 self-end text-[13px] leading-normal font-semibold text-text-3"
        >
          비밀번호를 잊으셨나요?
        </Link>

        <AnimatePresence initial={false}>
          {formError && (
            <motion.p
              key={formError.id}
              role="alert"
              className="text-sm leading-normal font-semibold text-danger"
              initial={{ opacity: 0, x: 0 }}
              animate={{ opacity: 1, x: [-4, 4, -2, 2, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              {formError.text}
            </motion.p>
          )}
        </AnimatePresence>
        {notice}

        <SubmitButton pending={isSubmitting} pendingText="로그인하는 중…">
          로그인
        </SubmitButton>
      </form>

      <KakaoButton>카카오 로그인</KakaoButton>

      <Link
        href={ROUTES.signup}
        className="text-center text-sm leading-normal font-bold text-brand-ink"
      >
        계정이 없나요? 회원가입
      </Link>
    </div>
  );
}
