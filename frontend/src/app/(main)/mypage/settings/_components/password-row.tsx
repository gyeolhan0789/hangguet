"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Field, PasswordInput } from "@/components/form";
import { changePassword } from "@/lib/user/actions";
import { passwordChangeSchema, type PasswordChangeValues } from "@/lib/user/schemas";
import { useToastStore } from "@/stores/toast-store";

import {
  OutlineButton,
  pressableRow,
  RowArrow,
  RowError,
  rowTitle,
  TextButton,
} from "./settings-ui";

// 기준: Figma S09-1 Row 비밀번호 변경(18:3216: '비밀번호 변경' 16 SemiBold · chevron-right 18) · Swagger 2.3 비밀번호 변경
// (PasswordChangeRequest: currentPassword · newPassword 8~64자 영문 · 숫자, 400 PASSWORD_MISMATCH "비밀번호가 맞지 않아요.")
// 비밀번호 변경 화면은 Figma에 없어, 닉네임처럼 줄 아래로 펼쳐 입력받는다(입력칸은 S01-1 회원가입 md 입력칸).

/** 비밀번호를 바꾼 뒤 체크 토스트 문구(Figma에 문구가 없어 새로 정함) */
export const PASSWORD_CHANGED_TOAST = "비밀번호를 바꿨어요";

export function PasswordRow() {
  const notify = useToastStore((state) => state.show);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<PasswordChangeValues>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });
  const { errors } = form.formState;

  function close() {
    form.reset();
    setOpen(false);
  }
  // 한 번 본 화면은 상태를 살려 다시 보여 주므로(cacheComponents · Activity), 떠날 때 접고 입력한 비밀번호를 지운다
  const { reset } = form;
  useLayoutEffect(
    () => () => {
      reset();
      setOpen(false);
    },
    [reset],
  );

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await changePassword(values);
      if (result.ok) {
        close();
        notify({ text: PASSWORD_CHANGED_TOAST, icon: "/home/icon-check.svg" });
        return;
      }
      for (const field of ["currentPassword", "newPassword"] as const) {
        const fieldError = result.fieldErrors?.[field];
        if (fieldError) form.setError(field, { message: fieldError });
      }
      if (result.formError) form.setError("root", { message: result.formError });
    }),
  );

  const message = (name: keyof PasswordChangeValues) => {
    const text = errors[name]?.message;
    return text ? { text, tone: "error" as const } : undefined;
  };

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls="password-change"
        className={pressableRow}
      >
        <span className={rowTitle}>비밀번호 변경</span>
        <span className="flex-1" />
        <span className={`flex transition-transform ${open ? "rotate-90" : ""}`}>
          <RowArrow />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.form
            id="password-change"
            onSubmit={submit}
            noValidate
            className="flex flex-col gap-4 overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <Field
              label="지금 비밀번호"
              htmlFor="currentPassword"
              variant="md"
              message={message("currentPassword")}
            >
              <PasswordInput
                id="currentPassword"
                variant="md"
                autoComplete="current-password"
                invalid={!!errors.currentPassword}
                {...form.register("currentPassword")}
              />
            </Field>
            <Field
              label="새 비밀번호"
              htmlFor="newPassword"
              variant="md"
              message={message("newPassword")}
            >
              <PasswordInput
                id="newPassword"
                variant="md"
                autoComplete="new-password"
                invalid={!!errors.newPassword}
                {...form.register("newPassword")}
              />
            </Field>
            <RowError>{errors.root?.message}</RowError>
            <div className="flex items-center justify-end gap-2.5 pb-[18px]">
              <TextButton onClick={close} disabled={pending}>
                취소
              </TextButton>
              <OutlineButton type="submit" disabled={pending} aria-busy={pending || undefined}>
                변경
              </OutlineButton>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
