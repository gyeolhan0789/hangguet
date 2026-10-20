"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { MaskIcon } from "@/components/mask-icon";

// 기준: Figma S09-1 Email Reminder · Coming Soon(18:3223: bg-sub · line 테두리 · 둥글기 20 · 패딩 24 · 간격 14 · 메일 44(둥글기 12 · mail 20)
// · '연습 알림 메일' 16 ExtraBold text-2 · 🔒 '추가 예정' 칩 · 설명 14 Medium text-3 · Disabled Row(opacity .5 · 좌우 16 · 위아래 12
// · 둥글기 12 · '알림 시간' 15 SemiBold · '매일 21:00' 15 Medium text-3 · Toggle Off 44×26(트랙 line · 손잡이 흰색 20)))
// · 기획 메모 S09-1(18:1251: 연습 알림 메일은 MVP 제외 → 토글 · 시간 비활성) · API 명세 1장(연습 알림 메일 API 없음)
// · 모션 메모 S09-1(18:3261: 토글 클릭 시 흔들림 + 툴팁 '곧 열려요!' (상태 변경 X))

const TOOLTIP_MS = 1500;

export function ReminderCard() {
  const [scope, animate] = useAnimate<HTMLButtonElement>();
  const reduce = useReducedMotion();
  const [tipAt, setTipAt] = useState<number>();

  useEffect(() => {
    if (tipAt === undefined) return;
    const timer = setTimeout(() => setTipAt(undefined), TOOLTIP_MS);
    return () => clearTimeout(timer);
  }, [tipAt]);

  function press() {
    if (!reduce && scope.current) {
      animate(scope.current, { x: [-4, 4, -2, 2, 0] }, { duration: 0.35 });
    }
    setTipAt(Date.now());
  }

  return (
    <div className="flex w-full flex-col gap-3.5 rounded-[20px] border border-line bg-bg-sub p-6">
      <div className="flex w-full items-start gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface">
          <MaskIcon src="/mypage/icon-mail.svg" size={20} className="bg-text-3" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1 tracking-[-0.2px]">
          <div className="flex items-center gap-2">
            <h3 className="text-base leading-normal font-extrabold text-text-2">연습 알림 메일</h3>
            <span className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-1">
              <MaskIcon src="/mypage/icon-lock-xs.svg" size={12} className="bg-text-3" />
              <span className="text-xs leading-normal font-bold text-text-3">추가 예정</span>
            </span>
          </div>
          <p className="max-w-[580px] text-sm leading-normal font-medium break-keep text-text-3">
            꾸준히 연습할 수 있도록, 정해진 시간에 연습 알림 메일을 보내는 기능을 추가하고 있어요!
          </p>
        </div>
      </div>
      <div className="flex w-full items-center gap-2.5 rounded-xl bg-bg-sub px-4 py-3 tracking-[-0.2px]">
        <span className="text-[15px] leading-normal font-semibold text-text-1 opacity-50">
          알림 시간
        </span>
        <span className="flex-1" />
        <span className="text-[15px] leading-normal font-medium text-text-3 opacity-50">
          매일 21:00
        </span>
        <span className="relative flex">
          <button
            ref={scope}
            type="button"
            role="switch"
            aria-checked="false"
            aria-label="연습 알림 메일"
            onClick={press}
            className="flex h-[26px] w-11 cursor-not-allowed items-center rounded-full bg-line p-[3px] opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <span className="size-5 rounded-full bg-white" />
          </button>
          <AnimatePresence>
            {tipAt !== undefined && (
              <motion.span
                key={tipAt}
                role="status"
                className="absolute right-0 bottom-full mb-2 rounded-lg bg-night-2 px-2.5 py-1.5 text-[13px] leading-normal font-semibold whitespace-nowrap text-white"
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                곧 열려요!
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>
    </div>
  );
}
