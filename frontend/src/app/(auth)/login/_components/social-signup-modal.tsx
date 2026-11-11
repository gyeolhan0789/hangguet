"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";

import { cycleTabFocus } from "@/components/cycle-tab-focus";
import { SubmitButton } from "@/components/form";
import { MaskIcon } from "@/components/mask-icon";
import { useLockScroll } from "@/components/use-lock-scroll";
import { AGREEMENT_ITEMS, socialSignupSchema, type SocialSignupValues } from "@/lib/auth/schemas";
import { cancelSocialSignup, socialSignup } from "@/lib/auth/social-actions";

import { AgreementsFieldset, type AgreementType } from "../../_components/agreements-fieldset";

// 기준: Figma S01-3 카카오 가입 · 약관 동의 모달(435:2095 모달 435:2189 · Dark 447:2136 모달 447:2230: S01 위 dim
// rgba(11,13,20,.65) · 다크 black/60, 모달 480 · 둥글기 24 · 패딩 32 · 간격 20 · bg-sub · 그림자 0 20 48 · 다크 line 테두리
// (C02 공지 모달과 같은 틀) · '회원가입' 24 Bold text-1 · '카카오 계정으로 가입해요' 16 Medium text-2(두 줄 자간 0) · ✕ 24 text-3
// · 약관 동의(S01-1 Agreements) · [가입하고 시작하기] 54)
// · 기획 메모 S01-3(423:2140: 필수 약관 모두 체크해야 버튼 활성 → 1.7 → 자동 로그인 → S02-D, ✕로 닫으면 가입 안 함(가입 토큰 삭제))
// · Swagger 1.7 소셜 회원가입 · 사용자 결정(2026-10-30: 가입 화면에 만 14세 이상 확인 — Figma 448:2153 · 448:2160)
// · WAI-ARIA 대화 상자 패턴: 열리면 모달로 포커스를 옮기고, Esc로 닫고, 모달 안에서만 Tab이 돈다. [보기] 본문(LegalModal)은
// 이 모달 안에 그려지므로 본문 안의 키 입력은 본문이 처리하게 둔다(본문을 닫는 Esc로 가입이 취소되지 않게).
// 오류 문구 자리는 모달에 없다: 서버가 거절하면 서버 액션이 모달을 닫고 S01 오류 문구 자리에 보인다(메모 S01-3).

export function SocialSignupModal() {
  const [open, setOpen] = useState(true);
  const dialog = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { isValid, isSubmitting },
  } = useForm<SocialSignupValues>({
    resolver: zodResolver(socialSignupSchema),
    mode: "onChange",
    defaultValues: { AGE: false, TERMS: false, PRIVACY: false, RECORDING: false },
  });
  const checked = useWatch({ control }) as Record<AgreementType, boolean>;
  useLockScroll(open);

  useEffect(() => {
    dialog.current?.focus();
  }, []);

  function toggleAll(next: boolean) {
    for (const { type } of AGREEMENT_ITEMS) {
      setValue(type, next, { shouldValidate: true, shouldDirty: true });
    }
  }

  // 성공하면 홈, 서버가 거절하면 모달을 닫고 S01에 문구를 보이도록 서버 액션이 이동한다.
  const onSubmit = handleSubmit((values) => socialSignup(values));

  // 닫는 모션이 끝난 뒤 가입 토큰을 지운다(먼저 지우면 화면이 다시 그려지며 모달이 모션 없이 사라진다).
  function close() {
    if (!isSubmitting) setOpen(false);
  }

  /** 이 모달에 속한 요소인지(안에 열린 [보기] 본문의 요소는 아니다) */
  const ownedBy = (element: Element) => element.closest('[role="dialog"]') === dialog.current;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element) || !ownedBy(event.target)) return;
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const items = [
      ...dialog.current.querySelectorAll<HTMLElement>("input, button:not(:disabled)"),
    ].filter(ownedBy);
    cycleTabFocus(event, items, dialog.current);
  }

  return (
    <AnimatePresence
      onExitComplete={() => {
        // 닫은 뒤 포커스를 로그인 폼(이메일 칸)으로 돌려준다
        document.getElementById("email")?.focus();
        void cancelSocialSignup();
      }}
    >
      {open && (
        <motion.div
          key="dim"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(11,13,20,0.65)] p-4 dark:bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          // dim을 눌러도 포커스가 모달 밖(본문)으로 나가지 않게
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) event.preventDefault();
          }}
        >
          <motion.div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="social-signup-title"
            aria-describedby="social-signup-description"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="flex max-h-full w-full max-w-[480px] flex-col overflow-y-auto rounded-3xl bg-bg-sub p-8 shadow-[0_20px_48px_rgba(0,0,0,0.25)] outline-none dark:border dark:border-line dark:shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
              <div className="flex items-start gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <h2
                    id="social-signup-title"
                    className="text-2xl leading-normal font-bold tracking-normal text-text-1"
                  >
                    회원가입
                  </h2>
                  <p
                    id="social-signup-description"
                    className="text-base leading-normal font-medium tracking-normal text-text-2"
                  >
                    카카오 계정으로 가입해요
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  disabled={isSubmitting}
                  aria-label="닫기"
                  className="flex shrink-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed"
                >
                  <MaskIcon src="/auth/icon-x.svg" size={24} className="bg-text-3" />
                </button>
              </div>

              <AgreementsFieldset checked={checked} register={register} onToggleAll={toggleAll} />

              <SubmitButton
                height="h-[54px]"
                disabled={!isValid}
                pending={isSubmitting}
                pendingText="가입하는 중…"
              >
                가입하고 시작하기
              </SubmitButton>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
