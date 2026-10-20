"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

// 기준: Figma 모션 메모 S03 "[다음] 클릭 → 다음 화면이 오른쪽에서 슬라이드 인 (x 40→0 · opacity, 단계 이동 공통)"
// template은 하위 단계 화면(S03 → S04 …)으로 바뀔 때마다 새로 그려지므로, 단계마다 들어오는 효과가 다시 재생된다.
export default function PracticeTemplate({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="flex flex-1 flex-col"
      initial={reduce ? false : { x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
