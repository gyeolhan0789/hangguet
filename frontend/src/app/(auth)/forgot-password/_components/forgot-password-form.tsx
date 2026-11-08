"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Field, SubmitButton, TextInput, type FieldMessage } from "@/components/form";
import { requestPasswordReset } from "@/lib/auth/actions";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/lib/auth/schemas";
import { ROUTES } from "@/lib/routes";

// 기준: Figma [보류] S01-2 비밀번호 찾기(18:3300: ① 입력 · ② 보낸 뒤) · Swagger 1.8 비밀번호 찾기 메일 요청(204만 응답) ·
// PasswordResetRequest · 사용자 결정(2026-11-08: 회원가입과 같은 틀, 메일 아이콘은 로고의 별을 원 안에, 다시 보내기 30초)
// 1.8은 가입 여부를 드러내지 않도록 결과와 관계없이 204라, 보낸 뒤 문구는 "가입했다면"으로 안내한다.

/** 다시 보낼 수 있을 때까지(초). BE 재요청 간격(password-reset.resend-interval 30초)과 같다 */
export const RESEND_WAIT_SECONDS = 30;
/** 서버가 돌려준 칸 오류(VALIDATION_FAILED)의 react-hook-form 오류 type */
const SERVER_ERROR = "server";

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting, touchedFields, dirtyFields },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onChange",
    defaultValues: { email: "" },
  });

  // 회원가입과 같이 입력하거나 벗어난 뒤에 보이고, 서버가 거절한 이유는 바로 보인다.
  const emailMessage: FieldMessage | undefined =
    errors.email?.message &&
    (touchedFields.email || dirtyFields.email || errors.email.type === SERVER_ERROR)
      ? { text: errors.email.message, tone: "error" }
      : undefined;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);
    const result = await requestPasswordReset(values);
    if (result.ok) {
      setSentTo(values.email);
      return;
    }
    if (result.fieldErrors?.email) {
      setError("email", { type: SERVER_ERROR, message: result.fieldErrors.email });
    }
    if (result.formError) setFormError(result.formError);
  });

  if (sentTo) return <SentView email={sentTo} />;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Link href={ROUTES.login} className="self-start text-sm leading-normal font-bold text-text-3">
        ‹ 로그인으로
      </Link>
      <div className="flex flex-col gap-1.5 pb-1.5">
        <h1 className="text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
          비밀번호 찾기
        </h1>
        <p className="text-[15px] leading-normal font-medium text-text-2">
          가입한 이메일로 재설정 링크를 보내드려요
        </p>
      </div>

      <Field label="이메일" htmlFor="email" variant="md" message={emailMessage}>
        <TextInput
          id="email"
          type="email"
          variant="md"
          autoComplete="email"
          placeholder="example@ssafy.com"
          invalid={!!emailMessage}
          {...register("email")}
        />
      </Field>

      <FormError text={formError} />

      <SubmitButton
        height="h-[54px]"
        disabled={!isValid}
        pending={isSubmitting}
        pendingText="보내는 중…"
      >
        재설정 링크 보내기
      </SubmitButton>
    </form>
  );
}

/** ② 보낸 뒤. 다시 보내기는 30초 뒤에 누를 수 있다 */
function SentView({ email }: { email: string }) {
  const [waitSeconds, setWaitSeconds] = useState(RESEND_WAIT_SECONDS);
  const [resending, setResending] = useState(false);
  const [formError, setFormError] = useState<string>();
  const titleRef = useRef<HTMLHeadingElement>(null);

  // 누르던 버튼이 사라지므로 바뀐 화면의 제목으로 포커스를 옮겨 스크린리더가 읽게 한다.
  useEffect(() => titleRef.current?.focus(), []);

  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = setTimeout(() => setWaitSeconds((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

  async function resend() {
    setResending(true);
    setFormError(undefined);
    const result = await requestPasswordReset({ email });
    setResending(false);
    if (result.ok) setWaitSeconds(RESEND_WAIT_SECONDS);
    else setFormError(result.formError ?? result.fieldErrors?.email);
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <motion.span
        className="flex size-20 items-center justify-center rounded-full bg-brand-soft dark:bg-brand-soft/8"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 18 }}
      >
        <Image src="/auth/icon-star-logo.png" alt="" width={48} height={48} />
      </motion.span>
      <div className="flex flex-col gap-1.5 pb-1.5">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1 outline-none"
        >
          메일을 보냈어요!
        </h1>
        <p className="text-[15px] leading-normal font-medium break-keep text-text-2">
          {/* 사용자 결정(2026-11-08): 이메일 · 안내 · 스팸함 세 줄로 나눈다 */}
          <span className="break-all">{email}</span>(으)로 가입했다면
          <br />
          받은 편지함을 확인해주세요.
          <br />
          (스팸함도 확인)
        </p>
      </div>

      <Link
        href={ROUTES.login}
        className="flex h-[54px] w-full items-center justify-center rounded-[14px] bg-brand-strong px-6 text-[17px] leading-normal font-bold text-white"
      >
        로그인으로 돌아가기
      </Link>

      <FormError text={formError} />

      <p className="text-sm leading-normal font-medium text-text-3">
        메일이 안 왔나요?{" "}
        {waitSeconds > 0 ? (
          <span>다시 보내기 ({waitSeconds}초 후)</span>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={resending}
            className="cursor-pointer font-bold text-brand-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {resending ? "보내는 중…" : "다시 보내기"}
          </button>
        )}
      </p>
    </div>
  );
}

function FormError({ text }: { text?: string }) {
  return (
    <AnimatePresence initial={false}>
      {text && (
        <motion.p
          key={text}
          role="alert"
          className="text-sm leading-normal font-semibold text-danger"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, x: [-4, 4, -2, 2, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          {text}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
