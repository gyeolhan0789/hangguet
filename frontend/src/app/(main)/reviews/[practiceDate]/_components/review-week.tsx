"use client";

import { motion, useReducedMotion } from "motion/react";

import { MaskIcon } from "@/components/mask-icon";
import type { ReviewDay } from "@/lib/growth/review";
import { tierOf } from "@/lib/streak";

// 기준: Figma S08 Week(18:2748: 간격 12, 점 36 원 brand-strong · 흰 체크 16, 글자 12 Medium text-3 · 점과 간격 6
// · '오늘' 칸 테두리 3 단계 밝은 색(황금 #ffd66b · 활활 #ffa766 · 불씨 #ff7a45 = 단계 그라데이션 위 색) · 글자 12 ExtraBold brand-ink)
// · S08-B(18:4610: 연습 안 한 날은 빈 회색 점(surface)) · S08-C(18:4752: '오늘 · +1 … +6', 앞날은 회색)
// · 모션 메모 S08(18:2843: 이번 주 동그라미는 '오늘' 칸만 마지막에 체크가 그려짐)
// · 모션 메모 S08-C(18:4831: '오늘'만 체크가 그려지고 나머지는 회색 → 내일 칸이 살짝 깜빡여 다음 방문 유도)

/** 그날 칸 체크를 그리기 시작하는 때 · 다 그린 때(초) */
const CHECK_DELAY_S = 0.9;
const CHECK_DONE_S = CHECK_DELAY_S + 0.3;

/** 7일 동그라미 */
export function ReviewWeek({
  days,
  streak,
  first,
  today,
}: {
  days: ReviewDay[];
  /** 그날 스트릭(오늘 칸 테두리 색) */
  streak: number;
  first: boolean;
  /** 오늘 리뷰인지(지난 날이면 내일 칸을 깜빡여 부르지 않는다) */
  today: boolean;
}) {
  const reduce = useReducedMotion();
  const ring = tierOf(streak).from;
  return (
    <ol aria-label={first ? "앞으로의 7일" : "최근 7일 연습"} className="flex gap-2 sm:gap-3">
      {days.map((day, i) => (
        <li key={day.date} className="flex flex-col items-center gap-1.5">
          <motion.span
            className={`flex size-9 items-center justify-center rounded-full ${
              day.done ? "bg-brand-strong" : "bg-surface"
            } ${day.current ? "border-3" : ""}`}
            style={day.current ? { borderColor: ring } : undefined}
            // 첫 날의 내일 칸(+1)은 오늘 칸 체크가 다 그려진 뒤부터 살짝 깜빡여 다음 방문을 부른다.
            animate={first && today && i === 1 && !reduce ? { opacity: 0.45 } : undefined}
            transition={{
              duration: 0.9,
              delay: CHECK_DONE_S,
              repeat: Infinity,
              repeatType: "mirror",
              ease: "easeInOut",
            }}
          >
            {day.done && (
              // 그날 칸의 체크는 다른 칸보다 늦게, 왼쪽에서 오른쪽으로 그려진다.
              <motion.span
                className="flex"
                initial={reduce || !day.current ? false : { clipPath: "inset(0 100% 0 0)" }}
                animate={{ clipPath: "inset(0 0% 0 0)" }}
                transition={{ duration: 0.3, delay: CHECK_DELAY_S, ease: "easeOut" }}
              >
                <MaskIcon src="/review/icon-check-dot.svg" size={16} className="bg-white" />
              </motion.span>
            )}
          </motion.span>
          <span
            className={`text-xs leading-normal tracking-[-0.2px] ${
              day.current ? "font-extrabold text-brand-ink" : "font-medium text-text-3"
            }`}
          >
            {day.label}
            <span className="sr-only"> {day.done ? "연습함" : "연습 안 함"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
