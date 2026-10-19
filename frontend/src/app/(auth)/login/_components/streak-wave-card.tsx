"use client";

import { useAnimate, useReducedMotion, type AnimationSequence } from "motion/react";
import Image from "next/image";
import { useEffect } from "react";

import { PanelCard } from "../../_components/auth-shell";

const DONE_DAYS = ["월", "화", "수", "목", "금", "토"] as const;

// Figma 모션 메모 S01: 월 → 토 → 오늘 순서로 점이 하나씩만 튀고, 한 바퀴 뒤 1.2초 쉰다.
// '오늘'은 더 높이 튀며 링이 커졌다 돌아온다.
export function StreakWaveCard() {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const sequence: AnimationSequence = [...DONE_DAYS, "오늘"].flatMap((day) => {
      const today = day === "오늘";
      return [
        [
          `[data-dot="${day}"]`,
          { y: [0, today ? -18 : -12, 0] },
          { duration: 0.36, ease: "easeOut" },
        ],
        [
          `[data-day="${day}"]`,
          { scale: [1, today ? 1.15 : 1.08, 1] },
          { duration: 0.36, at: "<" },
        ],
      ];
    });
    const controls = animate(sequence, { repeat: Infinity, repeatDelay: 1.2 });
    return () => controls.stop();
  }, [reduce, animate]);

  return (
    <PanelCard caption="연속 연습" title="7일째 이어가는 중">
      <div ref={scope} className="flex gap-2.5">
        {[...DONE_DAYS, "오늘" as const].map((day) => {
          const today = day === "오늘";
          return (
            <div key={day} className="flex flex-col items-center gap-2">
              <Image
                data-dot={day}
                src={today ? "/auth/wave-dot-today.svg" : "/auth/wave-dot.svg"}
                alt=""
                width={10}
                height={12}
              />
              <span
                data-day={day}
                className={`flex size-9 items-center justify-center rounded-full ${
                  today ? "border-[2.5px] border-brand bg-bg-sub" : "bg-brand-strong"
                }`}
              >
                {!today && <Image src="/auth/icon-check-day.svg" alt="" width={16} height={16} />}
              </span>
              <span
                className={`text-[13px] leading-normal ${today ? "font-bold text-brand-ink" : "font-medium text-text-3"}`}
              >
                {day}
              </span>
            </div>
          );
        })}
      </div>
    </PanelCard>
  );
}
