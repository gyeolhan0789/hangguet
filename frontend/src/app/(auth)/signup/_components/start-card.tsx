"use client";

import { motion } from "motion/react";
import Image from "next/image";

import { PanelCard } from "../../_components/auth-shell";

const NEXT_DAYS = ["+1", "+2", "+3", "+4", "+5", "+6"] as const;

// Figma S01-1 Start Card. 가입이 끝나면 '오늘' 링이 주황으로 채워진다.
export function StartCard({ completed }: { completed: boolean }) {
  return (
    <PanelCard caption="가입하면 바로" title="첫 스트릭이 시작돼요" gap="gap-[18px]">
      <div className="flex gap-2.5">
        <div className="flex flex-col items-center gap-2">
          <span className="relative size-9 rounded-full border-[2.5px] border-brand bg-bg-sub">
            <motion.span
              className="absolute -inset-[2.5px] flex items-center justify-center rounded-full bg-brand-strong"
              initial={false}
              animate={completed ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 18 }}
            >
              <Image src="/auth/icon-check-day.svg" alt="" width={16} height={16} />
            </motion.span>
          </span>
          <span className="text-[13px] leading-normal font-bold text-brand-ink">오늘</span>
        </div>
        {NEXT_DAYS.map((day) => (
          <div key={day} className="flex flex-col items-center gap-2">
            <span className="size-9 rounded-full bg-surface" />
            <span className="text-[13px] leading-normal font-medium text-text-3">{day}</span>
          </div>
        ))}
      </div>
    </PanelCard>
  );
}
