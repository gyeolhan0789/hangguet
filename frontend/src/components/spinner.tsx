"use client";

import { motion } from "motion/react";

import { MaskIcon } from "@/components/mask-icon";

// 기준: Figma S05 Preparing의 Icon loader-circle(18:2474) · 모션 메모 S05(18:2492: 스피너 회전)

/** 도는 로딩 아이콘. 색은 className(bg-*)으로 칠한다. */
export function Spinner({ size, className }: Readonly<{ size: number; className: string }>) {
  return (
    <motion.span
      aria-hidden
      className="flex shrink-0"
      animate={{ rotate: 360 }}
      transition={{ duration: 1, ease: "linear", repeat: Infinity }}
    >
      <MaskIcon src="/devices/icon-loader-circle.svg" size={size} className={className} />
    </motion.span>
  );
}
