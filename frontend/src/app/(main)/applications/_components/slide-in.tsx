"use client";

import { motion, MotionConfig, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

// 기준: 모션 메모 지원 관리 · 삭제 확인("성공(204) → 모달이 닫히고 목록으로 이동 (단계 이동 공통 슬라이드)")
// · 모션 메모 S03(단계 이동 공통: x 40→0 · opacity) — 연습 단계 화면(practice/template.tsx)과 같은 값.
// 지원 관리 목록에 들어올 때 한 번 재생된다. 같은 화면에서 페이지만 넘길 때는 다시 그리지 않아 재생되지 않는다.
export function SlideIn({ children }: Readonly<{ children: ReactNode }>) {
  const reduce = useReducedMotion();
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className="flex flex-1 flex-col"
        initial={reduce ? false : { x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}
