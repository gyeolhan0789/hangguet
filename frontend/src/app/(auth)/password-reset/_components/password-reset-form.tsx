"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Field, SubmitButton, TextInput, type FieldMessage } from "@/components/form";
import { resetPassword } from "@/lib/auth/actions";
import { PASSWORD_MAX, passwordResetSchema, type PasswordResetValues } from "@/lib/auth/schemas";
import { ROUTES } from "@/lib/routes";

import { PasswordRules } from "../../_components/password-rules";

// 기준: Swagger 1.9 비밀번호 재설정(204 · 400 PASSWORD_RESET_TOKEN_INVALID · VALIDATION_FAILED) · PasswordResetConfirmRequest ·
// 사용자 결정(2026-11-08: Figma 시안이 없어 회원가입 입력 틀 · 비밀번호 규칙 칩을 쓴다)

const titleClass =
  "text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1 outline-none";
const descriptionClass = "text-[15px] leading-normal font-medium text-text-2";
const primaryLinkClass =
  "flex h-[54px] w-full items-center justify-center rounded-[14px] bg-brand-strong px-6 text-[17px] leading-normal font-bold text-white";
/** 서버가 돌려준 칸 오류(VALIDATION_FAILED)의 react-hook-form 오류 type */
const SERVER_ERROR = "server";

export function PasswordResetForm({ token }: Readonly<{ token: string }>) {
  const [done, setDone] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(!token);
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    control,
    setError,
    trigger,
    getValues,
    formState: { errors, isValid, isSubmitting, touchedFields, dirtyFields },
  } = useForm<PasswordResetValues>({
    resolver: zodResolver(passwordResetSchema),
    mode: "onChange",
    defaultValues: { password: "", passwordConfirm: "" },
  });

  const password = useWatch({ control, name: "password" });

  // 제출 뒤 화면(성공 · 링크 무효)으로 바뀌면 누르던 버튼이 사라지므로 새 제목으로 포커스를 옮겨 스크린리더가 읽게 한다.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const changedView = useRef(false);
  useEffect(() => {
    if (changedView.current) titleRef.current?.focus();
    changedView.current = true;
  }, [done, linkInvalid]);

  // 비밀번호를 고치면, 이미 입력한 확인 칸도 다시 비교한다(회원가입과 같음).
  useEffect(() => {
    if (getValues("passwordConfirm")) void trigger("passwordConfirm");
  }, [password, getValues, trigger]);

  const shownError = (name: "password" | "passwordConfirm"): FieldMessage | undefined => {
    const error = errors[name];
    if (!error?.message || !(touchedFields[name] || dirtyFields[name])) return undefined;
    // 비밀번호 규칙은 칩으로 보여 주므로, 화면 검사 문구는 최대 길이를 넘었을 때만 띄운다.
    if (name === "password" && error.type !== SERVER_ERROR && password.length <= PASSWORD_MAX) {
      return undefined;
    }
    return { text: error.message, tone: "error" };
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await resetPassword(token, values);
    if (result.ok) {
      setDone(true);
      return;
    }
    if (result.linkInvalid) {
      setLinkInvalid(true);
      setFormError(result.formError);
      return;
    }
    if (result.fieldErrors?.newPassword) {
      setError("password", { type: SERVER_ERROR, message: result.fieldErrors.newPassword });
    }
    if (result.formError) setFormError(result.formError);
  });

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 pb-1.5">
          <h1 ref={titleRef} tabIndex={-1} className={titleClass}>
            비밀번호를 바꿨어요
          </h1>
          <p className={descriptionClass}>새 비밀번호로 다시 로그인해 주세요</p>
        </div>
        <Link href={ROUTES.login} className={primaryLinkClass}>
          로그인하러 가기
        </Link>
      </div>
    );
  }

  if (linkInvalid) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 pb-1.5">
          <h1 ref={titleRef} tabIndex={-1} className={titleClass}>
            새 비밀번호 설정
          </h1>
          <p role="alert" className="text-[15px] leading-normal font-semibold text-danger">
            {formError ?? "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요."}
          </p>
        </div>
        <Link href={ROUTES.forgotPassword} className={primaryLinkClass}>
          재설정 링크 다시 받기
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 pb-1.5">
        <h1 className={titleClass}>새 비밀번호 설정</h1>
        <p className={descriptionClass}>앞으로 로그인할 비밀번호를 정해 주세요</p>
      </div>

      <Field
        label="새 비밀번호"
        htmlFor="password"
        variant="md"
        message={shownError("password")}
        hint={<PasswordRules password={password} />}
      >
        <TextInput
          id="password"
          type="password"
          variant="md"
          autoComplete="new-password"
          placeholder="8자 이상, 영문 + 숫자"
          invalid={!!shownError("password")}
          {...register("password")}
        />
      </Field>

      <Field
        label="비밀번호 확인"
        htmlFor="passwordConfirm"
        variant="md"
        message={shownError("passwordConfirm")}
      >
        <TextInput
          id="passwordConfirm"
          type="password"
          variant="md"
          autoComplete="new-password"
          placeholder="한 번 더 입력"
          invalid={!!shownError("passwordConfirm")}
          {...register("passwordConfirm")}
        />
      </Field>

      <AnimatePresence initial={false}>
        {formError && (
          <motion.p
            key={formError}
            role="alert"
            className="text-sm leading-normal font-semibold text-danger"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, x: [-4, 4, -2, 2, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            {formError}
          </motion.p>
        )}
      </AnimatePresence>

      <SubmitButton
        height="h-[54px]"
        disabled={!isValid}
        pending={isSubmitting}
        pendingText="바꾸는 중…"
      >
        비밀번호 바꾸기
      </SubmitButton>
    </form>
  );
}
