"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";

import { useToastStore } from "@/stores/toast-store";

import { MaskIcon } from "./mask-icon";

// 기준: Figma 토스트(S06-F Mic Toast 18:4421: 높이 56 · night-2(#191f28) · 둥글기 16 · 좌우 18 · 15 SemiBold 흰색 · 아이콘 18)
// S04 '곧 만나요!'(persona-list)와 같은 모양 · 같은 등장(아래에서 y 8→0 · opacity)이다.

/** 토스트가 떠 있는 시간 */
export const TOAST_MS = 2000;

/**
 * 화면 아래 가운데 토스트. 띄우기는 useToastStore().show로 한다. 화면마다 하나만 둔다.
 * 화면 읽기 프로그램에도 읽히도록 상태 알림 요소(output, 암묵 역할 status) 안에 둔다.
 */
export function Toast({
  bottom = "bottom-10",
}: Readonly<{
  /** 화면 아래에서 떨어진 거리(Tailwind bottom-*) */ bottom?: string;
}>) {
  const reduce = useReducedMotion();
  const toast = useToastStore((state) => state.toast);
  const hide = useToastStore((state) => state.hide);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(hide, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, hide]);

  // 화면을 떠나면 떠 있던 토스트를 지운다(다른 화면에 넘어가지 않게).
  useEffect(() => hide, [hide]);

  return (
    <output
      className={`pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 ${bottom}`}
    >
      <AnimatePresence>
        {toast && (
          <motion.span
            key={toast.id}
            className="flex h-14 items-center gap-2.5 rounded-2xl bg-night-2 px-[18px] text-[15px] leading-normal font-semibold tracking-[-0.2px] text-white"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
          >
            {toast.icon && <MaskIcon src={toast.icon} size={18} className="bg-white" />}
            {toast.text}
          </motion.span>
        )}
      </AnimatePresence>
    </output>
  );
}
