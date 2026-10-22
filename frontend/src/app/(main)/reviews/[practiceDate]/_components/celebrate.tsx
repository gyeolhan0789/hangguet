"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect } from "react";

import { ConfettiBurst } from "@/components/confetti-burst";
import { MaskIcon } from "@/components/mask-icon";
import { badgeGradient, tierOf, withAlpha } from "@/lib/streak";
import { tierChipText, tierChipTone } from "@/lib/growth/review";

// 기준: Figma S08 Celebrate(18:2729: 간격 10, 후광 176 · 배지 뒤 위 -44, 배지 88 원 · 단계 색 그라데이션 · 그림자 0 6 20 단계 색 .4
// · 흰 불꽃 44 · 빛줄기 16×140 흰색 .4 30° · 제목 44 ExtraBold 행간 1.3 자간 -1.4 · Sub 간격 10 — 16 Medium text-3
// · 불꽃 칩 px12 py6 간격 6 불꽃 14 · 13 Bold · 색종이 6색) · S08-B(18:4597) · S08-C(18:4739: '1일째 시작!')
// · 모션 메모 S08(18:2843: 배지가 scale 0 → 1.15 → 1 spring으로 등장 + 색종이 터짐 + 후광 숨쉬기, '8일째' 숫자 카운트업 7 → 8)
// · 모션 메모 S08-C(18:4831: 불씨 배지가 '톡' 점화 — scale 0 → 1.2 → 1 + 불꽃 아이콘 y 8 → 0) · lib/streak 단계 색(확정)
// · 사용자 결정(2026-10-22: 색종이는 첫 면접(S08-C)이 아니면 터뜨린다, S02-L 레벨업의 종이폭죽(종이대포)처럼 배지에서 펑 터져
//   떨어지게 한다)

/** 종이폭죽 색: Figma S08 색종이 6색(brand · #3d7bff · #f5a000 · brand-strong · #1fb57a · #9b5cff) */
const CONFETTI_COLORS = ["#ff8a3d", "#3d7bff", "#f5a000", "#ff7a26", "#1fb57a", "#9b5cff"] as const;
/** 모션 메모 '색종이 6~20개' 중 가장 풍성하게 */
const CONFETTI_COUNT = 20;
/** 터지는 세기: 레벨업 종이폭죽보다 조금 더 세게(사용자 결정 2026-10-22: 더 강하게) */
const CONFETTI_POWER = 1.2;
/** 배지가 자리 잡을 즈음 터진다(초) */
const CONFETTI_AT = 0.25;

/** 배지 · 제목 · 그날 요약 · 불꽃 칩. sub는 '10월 13일 · 오늘 면접 1회 · 18분' 같은 한 줄 */
export function Celebrate({
  days,
  first,
  sub,
}: {
  days: number;
  /** 첫 연습일(S08-C) */
  first: boolean;
  sub: string;
}) {
  const reduce = useReducedMotion();
  const tier = tierOf(days);
  const tone = tierChipTone(tier);
  // '8일째' 숫자가 7 → 8로 올라간다(첫 날은 1 그대로).
  const count = useMotionValue(first || reduce ? days : Math.max(0, days - 1));
  const shown = useTransform(count, (value) => Math.round(value));
  useEffect(() => {
    if (first || reduce) return;
    const controls = animate(count, days, { duration: 0.6, delay: 0.4, ease: "easeOut" });
    return () => controls.stop();
  }, [count, days, first, reduce]);

  return (
    <div className="relative flex flex-col items-center gap-2.5">
      {/* 후광: 단계 색으로 번지며 천천히 숨쉰다(1 → 1.12를 왕복). */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -top-11 left-1/2 -ml-[88px] size-[176px] rounded-full"
        style={{
          background: `radial-gradient(circle closest-side, ${withAlpha(tier.to, 0.35)} 0%, ${withAlpha(tier.to, 0.12)} 55%, ${withAlpha(tier.to, 0)} 100%)`,
        }}
        animate={reduce ? undefined : { scale: 1.12 }}
        transition={{ duration: 1.6, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
      />
      {/* 종이폭죽은 배지 밖으로 날아가야 해서, 배지(잘림)를 감싼 자리에서 터뜨린다. 배지보다 먼저 그려 배지 뒤로 지나간다. */}
      <span className="relative flex">
        {!first && (
          <ConfettiBurst
            colors={CONFETTI_COLORS}
            count={CONFETTI_COUNT}
            power={CONFETTI_POWER}
            delay={CONFETTI_AT}
          />
        )}
        <motion.span
          className="relative flex size-22 items-center justify-center overflow-hidden rounded-full"
          style={{
            background: badgeGradient(tier),
            boxShadow: `0 6px 20px ${withAlpha(tier.to, 0.4)}`,
          }}
          initial={reduce ? false : { scale: 0 }}
          // S08은 spring으로 15%쯤 넘쳤다가 자리 잡고, S08-C는 '톡' 0 → 1.2 → 1로 점화된다.
          animate={first ? { scale: [0, 1.2, 1] } : { scale: 1 }}
          transition={
            first
              ? { duration: 0.6, times: [0, 0.6, 1], ease: "easeOut" }
              : { type: "spring", stiffness: 260, damping: 11 }
          }
        >
          <motion.span
            className="flex"
            initial={reduce || !first ? false : { y: 8 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
          >
            <MaskIcon src="/review/icon-flame-badge.svg" size={44} className="bg-white" />
          </motion.span>
          <motion.span
            aria-hidden
            className="absolute -top-[31px] left-0 h-[140px] w-4 rotate-30 bg-white/40"
            // 동작 줄이기면 Figma 자리(배지 위)에 멈춰 둔다.
            initial={{ x: reduce ? 36 : -60 }}
            animate={reduce ? undefined : { x: [-60, 120] }}
            transition={{
              duration: 0.8,
              delay: 0.6,
              repeat: Infinity,
              repeatDelay: 2.2,
              ease: "easeInOut",
            }}
          />
        </motion.span>
      </span>

      <h1 className="text-center text-[34px] leading-[1.3] font-extrabold tracking-[-1.4px] text-text-1 sm:text-[44px]">
        {first ? (
          `${days}일째 시작!`
        ) : (
          <>
            <span className="sr-only">{days}일째 연습 완료!</span>
            <span aria-hidden>
              <motion.span>{shown}</motion.span>일째 연습 완료!
            </span>
          </>
        )}
      </h1>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <p className="text-base leading-normal font-medium tracking-[-0.2px] text-text-3">{sub}</p>
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] leading-normal font-bold tracking-[-0.2px] ${tone.className ?? ""}`}
          style={tone.style}
        >
          <MaskIcon src="/review/icon-flame-chip.svg" size={14} className="bg-current" />
          {tierChipText(days)}
        </span>
      </div>
    </div>
  );
}
