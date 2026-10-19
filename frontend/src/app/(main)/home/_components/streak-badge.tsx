"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";

import { MaskIcon } from "@/components/mask-icon";
import { badgeGradient, tierOf, withAlpha } from "@/lib/streak";

/**
 * 홈 불꽃 뱃지 (Figma S02 Streak Hero · 모션 메모 '스트릭 뱃지').
 * 단계 색 그라데이션 + 후광 2겹 숨쉬기 + 3초마다 빛줄기. 0일(끊김)은 회색 원에 움직임 없음.
 */
export function StreakBadge({ days }: { days: number }) {
  const reduce = useReducedMotion();

  if (days === 0) {
    return (
      <span className="flex size-18 items-center justify-center rounded-full bg-surface">
        <MaskIcon src="/home/icon-flame-broken.svg" size={36} className="bg-text-3" />
      </span>
    );
  }

  const tier = tierOf(days);
  const loop = (duration: number, extra = {}) =>
    reduce ? undefined : { duration, repeat: Infinity, ease: "easeInOut" as const, ...extra };

  return (
    <span className="relative flex size-18 items-center justify-center">
      {/* 후광 2겹: 둥근 글로우만 쓴다(사방으로 뻗는 빛살은 쓰지 않는다) */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -inset-11 rounded-full"
        style={{
          background: `radial-gradient(circle, ${withAlpha(tier.to, 0.35)} 0%, ${withAlpha(tier.to, 0.12)} 55%, ${withAlpha(tier.to, 0)} 100%)`,
        }}
        animate={reduce ? undefined : { scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
        transition={loop(2.4)}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -inset-5"
        animate={reduce ? undefined : { scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
        transition={loop(2.4, { delay: 0.3 })}
      >
        <Image src="/home/halo-inner.svg" alt="" width={112} height={112} />
      </motion.span>
      <motion.span
        className="relative flex size-18 items-center justify-center overflow-hidden rounded-full"
        style={{
          background: badgeGradient(tier),
          boxShadow: `0 6px 20px ${withAlpha(tier.to, 0.4)}`,
        }}
        animate={reduce ? undefined : { scale: [1, 1.04, 1] }}
        transition={loop(3)}
      >
        <Image
          src="/home/icon-flame-badge.svg"
          alt=""
          width={36}
          height={36}
          className="relative"
        />
        <motion.span
          aria-hidden
          className="absolute -top-6 left-0 h-[120px] w-3.5 rotate-30 bg-white/40"
          initial={{ x: -60 }}
          animate={reduce ? undefined : { x: [-60, 120] }}
          transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 2.2, ease: "easeInOut" }}
        />
      </motion.span>
    </span>
  );
}

/** S02-D 첫 방문: 작게 깜빡이는 불씨 (후광 없음) */
export function SparkBadge() {
  const reduce = useReducedMotion();
  return (
    <motion.span
      className="flex size-18 items-center justify-center rounded-full bg-brand-soft dark:bg-brand-soft/8"
      animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    >
      <MaskIcon src="/home/icon-flame-first.svg" size={36} className="bg-brand" />
    </motion.span>
  );
}
