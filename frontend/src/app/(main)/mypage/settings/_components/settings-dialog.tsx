"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { useLockScroll } from "@/components/use-lock-scroll";

// 설정 화면의 안내 · 확인 모달 틀(카카오 연결 완료 안내 · 연결 해제 확인). 시안이 Figma에 없어 같은 화면의 탈퇴 확인 모달(withdraw-modal.tsx:
// S06-E 면접 종료 확인 18:4299 — 둥글기 24 · 패딩 32 · 간격 16 · 제목 24 ExtraBold · 설명 15 Medium text-2 가운데 · 버튼 높이 52 · 둥글기 14
// · 16 Bold, S05-E dim · 그림자)과 같은 모양 · 동작(Esc · dim으로 닫힘, 안에서만 Tab)을 따른다. 다크는 같은 마이페이지의 S09-2 · S09-3
// 모달(266:1614 · 266:1866: dim black/60 · 1px line 테두리)을 따른다.

export function SettingsDialog({
  open,
  title,
  description,
  busy = false,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  /** 처리 중이면 Esc · dim으로 닫지 않는다 */
  busy?: boolean;
  onClose: () => void;
  /** 아래 버튼 줄. 처음 포커스를 받을 버튼에 autoFocus를 준다 */
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const id = useId();
  useLockScroll(open);
  // 처리 중에는 버튼이 모두 비활성이 되어 포커스가 모달 밖으로 빠지므로, 모달 자체로 옮겨 키(Tab 가두기)를 계속 받는다.
  useEffect(() => {
    if (busy) dialog.current?.focus();
  }, [busy]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy) {
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="dim"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(25,33,40,0.5)] px-4 py-6 dark:bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) onClose();
          }}
        >
          <motion.div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-describedby={description ? `${id}-description` : undefined}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="my-auto flex w-full max-w-[440px] flex-col gap-4 rounded-3xl bg-bg-sub p-8 drop-shadow-[0_20px_24px_rgba(25,33,40,0.25)] outline-none dark:border dark:border-line"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <div className="flex flex-col items-center gap-4 text-center tracking-[-0.2px]">
              <h2 id={`${id}-title`} className="text-2xl leading-normal font-extrabold text-text-1">
                {title}
              </h2>
              {description && (
                <p
                  id={`${id}-description`}
                  className="text-[15px] leading-normal font-medium text-text-2"
                >
                  {description}
                </p>
              )}
            </div>
            <div className="flex gap-2.5 pt-2">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const dialogButton =
  "flex h-[52px] flex-1 cursor-pointer items-center justify-center rounded-[14px] text-base leading-normal font-bold tracking-[-0.2px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed";

/**
 * 모달 버튼. secondary는 [취소](bg surface), danger는 되돌리기 어려운 동작(탈퇴하기와 같은 빨간색), primary는 [확인]
 * (S09-3 사용 완료 모달 266:1553의 [확인]과 같은 brand-strong)
 */
export const dialogButtonClass = {
  secondary: `${dialogButton} bg-surface text-text-1`,
  danger: `${dialogButton} bg-danger text-white`,
  primary: `${dialogButton} bg-brand-strong text-white`,
} as const;
