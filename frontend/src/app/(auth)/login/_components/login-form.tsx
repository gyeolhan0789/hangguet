"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Field, PasswordInput, SubmitButton, TextInput } from "@/components/form";
import { login } from "@/lib/auth/actions";
import { loginSchema, type LoginValues } from "@/lib/auth/schemas";
import { ROUTES } from "@/lib/routes";

const errorMessage = (text?: string) => (text ? { text, tone: "error" as const } : undefined);

export function LoginForm() {
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: "onTouched",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);
    // 성공하면 서버 액션이 홈으로 보내고, 실패하면 오류를 돌려준다.
    const result = await login(values);
    if (result?.fieldErrors) {
      for (const [field, text] of Object.entries(result.fieldErrors)) {
        if (field === "email" || field === "password") setError(field, { message: text });
      }
    }
    if (result?.formError) setFormError(result.formError);
  });

  return (
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

      <AnimatePresence initial={false}>
        {formError && (
          <motion.p
            key={formError}
            role="alert"
            className="text-sm leading-normal font-semibold text-danger"
            initial={{ opacity: 0, x: 0 }}
            animate={{ opacity: 1, x: [-4, 4, -2, 2, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            {formError}
          </motion.p>
        )}
      </AnimatePresence>

      <SubmitButton pending={isSubmitting} pendingText="로그인하는 중…">
        로그인
      </SubmitButton>

      <Link
        href={ROUTES.signup}
        className="text-center text-sm leading-normal font-bold text-brand-ink"
      >
        계정이 없나요? 회원가입
      </Link>
    </form>
  );
}
