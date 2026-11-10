"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, type ComponentProps, type ReactNode } from "react";

/** lg: S01 로그인(56px), md: S01-1 회원가입(50px) */
export type FieldVariant = "lg" | "md";

export interface FieldMessage {
  text: string;
  tone: "error" | "success" | "info";
}

const TONE_CLASS: Record<FieldMessage["tone"], string> = {
  error: "text-danger",
  success: "text-success",
  info: "text-text-3",
};

/** 라벨 + 입력칸 + 안내 문구. 오류가 새로 생기면 입력칸을 좌우로 흔든다. */
export function Field({
  label,
  htmlFor,
  variant = "lg",
  message,
  hint,
  messageClass,
  children,
}: Readonly<{
  label: string;
  htmlFor: string;
  variant?: FieldVariant;
  message?: FieldMessage;
  /** 입력칸 아래 고정 안내(예: 비밀번호 규칙) */
  hint?: ReactNode;
  /** 안내 문구 글자 크기 · 굵기를 화면 설계대로 바꿀 때(기본: lg 13 · md 12, SemiBold) */
  messageClass?: string;
  children: ReactNode;
}>) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reduce = useReducedMotion();
  const errorText = message?.tone === "error" ? message.text : undefined;
  const defaultMessageClass =
    variant === "lg" ? "font-semibold text-[13px]" : "font-semibold text-xs";

  useEffect(() => {
    if (errorText && !reduce && scope.current) {
      animate(scope.current, { x: [-4, 4, -2, 2, 0] }, { duration: 0.35 });
    }
  }, [errorText, reduce, animate, scope]);

  return (
    <div className={`flex flex-col ${variant === "lg" ? "gap-2" : "gap-1.5"}`}>
      <label
        htmlFor={htmlFor}
        className={`leading-normal text-text-2 ${variant === "lg" ? "text-sm font-semibold" : "text-[13px] font-bold"}`}
      >
        {label}
      </label>
      <div ref={scope}>{children}</div>
      {hint}
      <AnimatePresence initial={false}>
        {message && (
          <motion.p
            key={message.text}
            id={`${htmlFor}-message`}
            role={message.tone === "error" ? "alert" : undefined}
            className={`leading-normal ${messageClass ?? defaultMessageClass} ${TONE_CLASS[message.tone]}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {message.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** react-hook-form `register()` 결과를 그대로 펼쳐 넣을 수 있는 입력칸 */
export function TextInput({
  variant = "lg",
  invalid = false,
  trailing,
  ...props
}: Omit<ComponentProps<"input">, "size"> & {
  variant?: FieldVariant;
  invalid?: boolean;
  /** 입력칸 오른쪽 아이콘·버튼 */
  trailing?: ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border bg-bg-sub px-4 transition-colors focus-within:border-brand focus-within:ring-1 focus-within:ring-brand ${
        invalid ? "border-danger ring-1 ring-danger" : "border-line"
      } ${variant === "lg" ? "h-14" : "h-[50px]"}`}
    >
      <input
        aria-invalid={invalid || undefined}
        aria-describedby={props.id ? `${props.id}-message` : undefined}
        className={`min-w-0 flex-1 bg-transparent leading-normal text-text-1 outline-none placeholder:font-medium placeholder:text-text-3 ${
          variant === "lg" ? "text-base font-medium" : "text-[15px] font-semibold"
        }`}
        {...props}
      />
      {trailing}
    </div>
  );
}
