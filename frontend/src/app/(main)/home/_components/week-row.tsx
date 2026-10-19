"use client";

import { useAnimate, useReducedMotion, type AnimationSequence } from "motion/react";
import Image from "next/image";
import { useEffect } from "react";

import { MaskIcon } from "@/components/mask-icon";
import type { WeekDay } from "@/lib/home/week";

function DayDot({ day }: { day: WeekDay }) {
  switch (day.status) {
    case "done":
    case "today-done":
      return (
        <span className="flex size-9 items-center justify-center rounded-full bg-brand-strong sm:size-11">
          <Image src="/home/icon-check.svg" alt="" width={20} height={20} />
        </span>
      );
    case "missed":
      return (
        <span className="flex size-9 items-center justify-center rounded-full bg-surface sm:size-11">
          <MaskIcon src="/home/icon-x.svg" size={18} className="bg-text-3" />
        </span>
      );
    case "empty":
      return <span className="size-9 rounded-full bg-surface sm:size-11" />;
    case "today":
      return (
        <span className="size-9 rounded-full border-[2.5px] border-brand bg-bg-sub sm:size-11" />
      );
  }
}

const STATUS_TEXT: Record<WeekDay["status"], string> = {
  done: "연습함",
  "today-done": "연습함",
  missed: "빠짐",
  empty: "기록 없음",
  today: "아직 안 함",
};

/**
 * 이번 주 7칸 (Figma S02 Week · 모션 메모 'S02 스트릭 파도').
 * 월 → … → 오늘 순서로 점이 하나씩만 튀고 한 바퀴 뒤 1.2초 쉰다. 빠진 날은 건너뛰고, 오늘은 더 높이 튄다.
 * 첫 방문(S02-D)은 점 없이 '오늘' 링만 숨쉰다.
 */
export function WeekRow({ days, wave = true }: { days: WeekDay[]; wave?: boolean }) {
  const [scope, animate] = useAnimate<HTMLOListElement>();
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    if (!wave) {
      const controls = animate(
        '[data-ring="today"]',
        { scale: [1, 1.08, 1] },
        { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
      );
      return () => controls.stop();
    }
    const sequence: AnimationSequence = days
      .map((day, i) => ({ day, i }))
      .filter(({ day }) => day.status !== "missed")
      .flatMap(({ day, i }) => {
        const today = day.status === "today" || day.status === "today-done";
        return [
          [
            `[data-dot="${i}"]`,
            { y: [0, today ? -18 : -12, 0] },
            { duration: 0.36, ease: "easeOut" },
          ],
          [
            `[data-day="${i}"]`,
            { scale: [1, today ? 1.15 : 1.08, 1] },
            { duration: 0.36, at: "<" },
          ],
        ];
      });
    const controls = animate(sequence, { repeat: Infinity, repeatDelay: 1.2 });
    return () => controls.stop();
  }, [days, wave, reduce, animate]);

  return (
    <ol ref={scope} className="flex gap-2 sm:gap-3.5">
      {days.map((day, i) => {
        const today = day.status === "today" || day.status === "today-done";
        return (
          <li key={day.date} className="flex flex-col items-center gap-2">
            {wave &&
              (day.status === "missed" ? (
                <MaskIcon
                  src="/home/wave-dot-missed.svg"
                  width={12}
                  height={16}
                  className="bg-line"
                />
              ) : (
                <Image
                  data-dot={i}
                  src={today ? "/home/wave-dot-today.svg" : "/home/wave-dot.svg"}
                  alt=""
                  width={12}
                  height={16}
                />
              ))}
            <span data-day={i} data-ring={today ? "today" : undefined} className="flex">
              <DayDot day={day} />
            </span>
            <span
              className={`text-[13px] leading-normal ${today ? "font-bold text-brand-ink" : "font-medium text-text-3"}`}
            >
              {day.label}
              <span className="sr-only"> {STATUS_TEXT[day.status]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
