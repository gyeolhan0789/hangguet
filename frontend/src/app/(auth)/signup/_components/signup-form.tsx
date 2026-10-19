"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Checkbox, Field, SubmitButton, TextInput, type FieldMessage } from "@/components/form";
import { checkEmailAvailable, signup } from "@/lib/auth/actions";
import {
  emailSchema,
  PASSWORD_MAX,
  PASSWORD_RULES,
  signupSchema,
  TERMS,
  type SignupValues,
} from "@/lib/auth/schemas";
import { ROUTES } from "@/lib/routes";

const EMAIL_CHECK_DELAY_MS = 400;

type EmailCheck = { email: string; available: boolean | null };

function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="flex gap-2.5">
      {PASSWORD_RULES.map(({ label, test }) => {
        const passed = test(password);
        return (
          <li key={label} className="flex items-center gap-1">
            <motion.span
              className="flex"
              initial={false}
              animate={passed ? { scale: [0.4, 1.2, 1] } : { scale: 1 }}
              transition={{ duration: 0.25 }}
            >
              <Image
                src={passed ? "/auth/icon-check-rule.svg" : "/auth/icon-circle-rule.svg"}
                alt=""
                width={12}
                height={12}
              />
            </motion.span>
            <span
              className={`text-xs leading-normal font-semibold ${passed ? "text-success" : "text-text-3"}`}
            >
              {label}
              <span className="sr-only">{passed ? " 충족" : " 미충족"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SignupForm({ onComplete }: { onComplete: () => void }) {
  const [formError, setFormError] = useState<string>();
  const [emailCheck, setEmailCheck] = useState<EmailCheck>();
  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    trigger,
    getValues,
    formState: { errors, isValid, isSubmitting, touchedFields, dirtyFields },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    mode: "onChange",
    defaultValues: {
      nickname: "",
      email: "",
      password: "",
      passwordConfirm: "",
      agreements: { TERMS: false },
    },
  });

  const email = useWatch({ control, name: "email" });
  const password = useWatch({ control, name: "password" });
  const agreements = useWatch({ control, name: "agreements" });
  const allAgreed = TERMS.every(({ type }) => agreements[type]);

  // 이메일 중복 확인: 형식이 맞으면 입력이 멈춘 뒤 0.4초 후 확인한다. 늦게 온 이전 응답은 email이 달라 무시된다.
  const emailFormatOk = emailSchema.safeParse(email).success;
  useEffect(() => {
    if (!emailFormatOk) return;
    const timer = setTimeout(async () => {
      setEmailCheck({ email, available: await checkEmailAvailable(email) });
    }, EMAIL_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [email, emailFormatOk]);

  const checked = emailFormatOk && emailCheck?.email === email ? emailCheck.available : undefined;

  // 비밀번호를 고치면, 이미 입력한 확인 칸도 다시 비교한다.
  useEffect(() => {
    if (getValues("passwordConfirm")) void trigger("passwordConfirm");
  }, [password, getValues, trigger]);

  function emailMessage(): FieldMessage | undefined {
    if (errors.email?.message) return { text: errors.email.message, tone: "error" };
    if (!emailFormatOk) return undefined;
    if (checked === true) return { text: "사용할 수 있는 이메일이에요", tone: "success" };
    if (checked === false) return { text: "이미 사용 중인 이메일이에요.", tone: "error" };
    if (checked === null) {
      return { text: "이메일을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", tone: "error" };
    }
    return { text: "사용할 수 있는지 확인하는 중…", tone: "info" };
  }

  const shownError = (
    name: "nickname" | "password" | "passwordConfirm",
  ): FieldMessage | undefined => {
    const message = errors[name]?.message;
    if (!message || !(touchedFields[name] || dirtyFields[name])) return undefined;
    // 비밀번호 규칙은 칩으로 보여 주므로, 문구는 최대 길이를 넘었을 때만 띄운다.
    if (name === "password" && password.length <= PASSWORD_MAX) return undefined;
    return { text: message, tone: "error" };
  };

  function toggleAll(next: boolean) {
    for (const { type } of TERMS) {
      setValue(`agreements.${type}`, next, { shouldValidate: true, shouldDirty: true });
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await signup(values);
    if (result.ok) {
      onComplete();
      return;
    }
    for (const [field, text] of Object.entries(result.fieldErrors ?? {})) {
      if (field === "nickname" || field === "email" || field === "password") {
        setError(field, { message: text });
      }
    }
    if (result.formError) setFormError(result.formError);
  });

  const emailMsg = emailMessage();

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 pb-1.5">
        <h1 className="text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
          회원가입
        </h1>
        <p className="text-[15px] leading-normal font-medium text-text-2">
          스트릭을 이어가기 위한 최소 정보만 받아요
        </p>
      </div>

      <Field label="닉네임" htmlFor="nickname" variant="md" message={shownError("nickname")}>
        <TextInput
          id="nickname"
          variant="md"
          autoComplete="nickname"
          placeholder="면접왕"
          invalid={!!shownError("nickname")}
          {...register("nickname")}
        />
      </Field>

      <Field label="이메일" htmlFor="email" variant="md" message={emailMsg}>
        <TextInput
          id="email"
          type="email"
          variant="md"
          autoComplete="email"
          placeholder="example@ssafy.com"
          invalid={emailMsg?.tone === "error"}
          trailing={
            <AnimatePresence>
              {checked === true && !errors.email && (
                <motion.span
                  className="flex shrink-0"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Image src="/auth/icon-circle-check.svg" alt="" width={18} height={18} />
                </motion.span>
              )}
            </AnimatePresence>
          }
          {...register("email")}
        />
      </Field>

      <Field
        label="비밀번호"
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

      <fieldset className="flex flex-col gap-2.5 rounded-xl bg-bg-sub p-4">
        <legend className="sr-only">약관 동의</legend>
        <Checkbox checked={allAgreed} onChange={(e) => toggleAll(e.target.checked)}>
          <span className="text-[15px] leading-normal font-extrabold text-text-1">전체 동의</span>
        </Checkbox>
        <span className="h-px bg-line" aria-hidden />
        {TERMS.map(({ type, label }, i) => (
          <div key={type} className="flex items-center gap-2.5">
            <Checkbox
              checked={agreements[type]}
              delay={allAgreed ? i * 0.05 : 0}
              className="flex-1"
              {...register(`agreements.${type}`)}
            >
              <span className="text-sm leading-normal font-medium text-text-1">{label}</span>
            </Checkbox>
            {/* 약관 본문이 아직 없어 보기 화면은 연결하지 않았다. */}
            <span className="text-[13px] leading-normal font-semibold text-text-3">보기</span>
          </div>
        ))}
      </fieldset>

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
        disabled={!isValid || checked !== true}
        pending={isSubmitting}
        pendingText="가입하는 중…"
      >
        가입하고 시작하기
      </SubmitButton>

      <p className="flex justify-center gap-1.5 text-sm leading-normal">
        <span className="font-medium text-text-3">이미 계정이 있나요?</span>
        <Link href={ROUTES.login} className="font-bold text-brand-ink">
          로그인
        </Link>
      </p>
    </form>
  );
}
