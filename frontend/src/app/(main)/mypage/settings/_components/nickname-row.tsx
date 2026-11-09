"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { changeNickname } from "@/lib/user/actions";
import { nicknameSchema, type NicknameValues } from "@/lib/user/schemas";

import {
  OutlineButton,
  pressableRow,
  RowArrow,
  RowError,
  rowTitle,
  TextButton,
} from "./settings-ui";

// 기준: Figma S09-1 Row 닉네임(18:3199: '닉네임' 16 SemiBold · 값 15 Medium text-2 · chevron-right 18) · Swagger 2.2 닉네임 변경
// (NicknameRequest 1~50자 · 앞뒤 공백 제거) · 모션 메모 S09-1(18:3261: 닉네임은 행에서 바로 인라인 편집(입력칸으로 morph))

export function NicknameRow({ nickname }: { nickname: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<NicknameValues>({
    resolver: zodResolver(nicknameSchema),
    defaultValues: { nickname },
  });
  const error = form.formState.errors.nickname?.message ?? form.formState.errors.root?.message;

  function open() {
    form.reset({ nickname });
    setEditing(true);
  }

  function close() {
    form.clearErrors();
    setEditing(false);
  }
  // 한 번 본 화면은 상태를 살려 다시 보여 주므로(cacheComponents · Activity), 떠날 때 편집칸을 접는다(다시 열면 지금 닉네임으로 시작)
  const { clearErrors } = form;
  useLayoutEffect(
    () => () => {
      clearErrors();
      setEditing(false);
    },
    [clearErrors],
  );

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await changeNickname(values);
      if (result.ok) {
        setEditing(false);
        return;
      }
      const message = result.fieldErrors?.nickname ?? result.formError;
      if (message) form.setError(result.fieldErrors?.nickname ? "nickname" : "root", { message });
    }),
  );

  return (
    <div className="flex flex-col">
      <AnimatePresence mode="popLayout" initial={false}>
        {editing ? (
          <motion.form
            key="editing"
            onSubmit={submit}
            noValidate
            className="flex items-center gap-2.5 py-2.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <label htmlFor="nickname" className={rowTitle}>
              닉네임
            </label>
            <span className="flex-1" />
            <motion.input
              layoutId="nickname-value"
              id="nickname"
              autoFocus
              autoComplete="nickname"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "nickname-error" : undefined}
              onKeyDown={(event) => {
                if (event.key === "Escape") close();
              }}
              {...form.register("nickname")}
              className={`h-10 w-full max-w-60 min-w-0 rounded-[10px] border bg-bg-sub px-3 text-[15px] leading-normal font-medium tracking-[-0.2px] text-text-1 outline-none focus:border-brand focus:ring-1 focus:ring-brand ${
                error ? "border-danger ring-1 ring-danger" : "border-line"
              }`}
            />
            <OutlineButton type="submit" disabled={pending} aria-busy={pending || undefined}>
              저장
            </OutlineButton>
            <TextButton onClick={close} disabled={pending}>
              취소
            </TextButton>
          </motion.form>
        ) : (
          <motion.button
            key="view"
            type="button"
            onClick={open}
            className={pressableRow}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <span className={rowTitle}>닉네임</span>
            <span className="flex-1" />
            <motion.span
              layoutId="nickname-value"
              className="truncate text-[15px] leading-normal font-medium tracking-[-0.2px] text-text-2"
            >
              {nickname}
            </motion.span>
            <RowArrow />
          </motion.button>
        )}
      </AnimatePresence>
      {editing && <RowError id="nickname-error">{error}</RowError>}
    </div>
  );
}
