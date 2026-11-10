"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useForm } from "react-hook-form";

import { cycleTabFocus } from "@/components/cycle-tab-focus";
import { Field, PasswordInput } from "@/components/form";
import { useLockScroll } from "@/components/use-lock-scroll";
import { withdraw, withdrawSocial } from "@/lib/user/actions";
import { withdrawSchema, type WithdrawValues } from "@/lib/user/schemas";

// 기준: 기획 메모 S09-1(18:1251: 회원 탈퇴 → 확인 모달(기록 · 스트릭 삭제 안내, 되돌릴 수 없음)) · 모션 메모 S09-1(18:3261: 확인 모달
// (기록 · 스트릭이 모두 사라져요, 되돌릴 수 없어요) · 버튼 빨간색) · Swagger 2.7 회원 탈퇴(WithdrawRequest: 본인 확인 비밀번호 — 이메일 회원은 필수
// · 400 PASSWORD_MISMATCH) · 탈퇴 확인 모달 시안은 Figma에 없어, 같은 확인 모달인 S06-E 면접 종료 확인(18:4299: 둥글기 24 · 패딩 32
// · 간격 16 · 제목 24 ExtraBold · 설명 15 Medium text-2 가운데 · 버튼 높이 52 · 둥글기 14 · 16 Bold)과 S05-E dim · 그림자를 따른다.
// · 소셜 회원은 비밀번호가 없어 비밀번호 칸 없이 탈퇴한다(WithdrawRequest.password "소셜 회원은 보내지 않는다" · 기획 메모 S09-1).

export function WithdrawModal({
  open,
  social = false,
  onClose,
}: Readonly<{
  open: boolean;
  /** 소셜 회원(2.1 socialProvider가 null이 아님)이면 비밀번호 칸을 두지 않는다 */
  social?: boolean;
  onClose: () => void;
}>) {
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // 소셜 회원은 입력 칸이 없어, 누른 [탈퇴하기]가 처리 중 비활성이 되며 포커스가 모달 밖으로 빠진다.
  // 실패해 버튼이 다시 켜지면(처리가 끝난 뒤) [취소]로 포커스를 돌려준다.
  const [failed, setFailed] = useState(0);
  const form = useForm<WithdrawValues>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: { password: "" },
  });
  const error = form.formState.errors.password?.message ?? form.formState.errors.root?.message;
  useEffect(() => {
    if (failed > 0 && !pending) cancel.current?.focus();
  }, [failed, pending]);
  useLockScroll(open);

  useEffect(() => {
    if (!open) form.reset();
  }, [open, form]);

  const submit = social
    ? (event: FormEvent) => {
        event.preventDefault();
        startTransition(async () => {
          // 성공하면 서버 액션이 쿠키를 지우고 첫 화면(S00)으로 보낸다.
          const result = await withdrawSocial();
          if (result.formError) {
            form.setError("root", { message: result.formError });
            setFailed((count) => count + 1);
          }
        });
      }
    : form.handleSubmit((values) =>
        startTransition(async () => {
          // 성공하면 서버 액션이 쿠키를 지우고 첫 화면(S00)으로 보낸다.
          const result = await withdraw(values);
          const message = result.fieldErrors?.password ?? result.formError;
          if (message) form.setError("password", { message });
        }),
      );

  // Esc로 닫고, 모달 안에서만 Tab이 돈다(aria-modal).
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>("input, button:not(:disabled)")];
    cycleTabFocus(event, items);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="dim"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(25,33,40,0.5)] px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) onClose();
          }}
        >
          <motion.div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-title"
            aria-describedby="withdraw-description"
            onKeyDown={onKeyDown}
            className="my-auto flex w-full max-w-[440px] flex-col gap-4 rounded-3xl bg-bg-sub p-8 drop-shadow-[0_20px_24px_rgba(25,33,40,0.25)]"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <div className="flex flex-col items-center gap-4 text-center tracking-[-0.2px]">
              <h2
                id="withdraw-title"
                className="text-2xl leading-normal font-extrabold text-text-1"
              >
                정말 탈퇴할까요?
              </h2>
              <p
                id="withdraw-description"
                className="text-[15px] leading-normal font-medium text-text-2"
              >
                기록 · 스트릭이 모두 사라져요
                <br />
                되돌릴 수 없어요
              </p>
            </div>
            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              {social ? (
                error && (
                  <p role="alert" className="text-[13px] leading-normal font-semibold text-danger">
                    {error}
                  </p>
                )
              ) : (
                <Field
                  label="비밀번호"
                  htmlFor="withdraw-password"
                  variant="md"
                  message={error ? { text: error, tone: "error" } : undefined}
                >
                  <PasswordInput
                    id="withdraw-password"
                    variant="md"
                    autoFocus
                    autoComplete="current-password"
                    invalid={!!error}
                    {...form.register("password")}
                  />
                </Field>
              )}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  ref={cancel}
                  autoFocus={social}
                  onClick={onClose}
                  disabled={pending}
                  className="flex h-[52px] flex-1 cursor-pointer items-center justify-center rounded-[14px] bg-surface text-base leading-normal font-bold tracking-[-0.2px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  aria-busy={pending || undefined}
                  className="flex h-[52px] flex-1 cursor-pointer items-center justify-center rounded-[14px] bg-danger text-base leading-normal font-bold tracking-[-0.2px] text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed"
                >
                  탈퇴하기
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
