"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

import { MaskIcon } from "@/components/mask-icon";
import { ROUTES } from "@/lib/routes";

// 기준: Figma S08 Decision(18:2833: 간격 14 · '한 번 더 할까요?' 20 ExtraBold · 버튼 간격 12 · 각 240×60 둥글기 16 px24 17 Bold
// · [오늘은 여기까지] surface text-1 · [한 번 더 면접] brand-strong 흰 글자 + rotate-ccw 20 간격 8)
// · 기획 메모 S08(18:767: [오늘은 여기까지] → S02-B 홈(오늘 완료) / [한 번 더 면접] → S03(지금은 S03 지원서 선택))
// · 모션 메모 S08(18:2843: 버튼 hover 시 아이콘 회전)
// · 사용자 결정(2026-10-22: 지난 날짜는 '오늘' 문구를 그날에 맞게 — '오늘도 연습해 볼까요?' · [홈으로] · [면접 연습하기])

/** 한 번 더 할지 묻는 버튼 2개 */
export function ReviewDecision({ today }: Readonly<{ today: boolean }>) {
  const reduce = useReducedMotion();
  return (
    <div className="flex w-full flex-col items-center gap-3.5">
      <p className="text-xl leading-normal font-extrabold tracking-[-0.2px] text-text-1">
        {today ? "한 번 더 할까요?" : "오늘도 연습해 볼까요?"}
      </p>
      <div className="flex w-full max-w-[492px] gap-3">
        <Link
          href={ROUTES.home}
          className="flex h-15 flex-1 items-center justify-center rounded-2xl bg-surface px-6 text-[17px] leading-normal font-bold tracking-[-0.2px] text-text-1"
        >
          {today ? "오늘은 여기까지" : "홈으로"}
        </Link>
        <motion.span className="flex flex-1" initial="rest" whileHover="hover" animate="rest">
          <Link
            href={ROUTES.practice}
            className="flex h-15 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-strong px-6 text-[17px] leading-normal font-bold tracking-[-0.2px] text-white"
          >
            {today ? "한 번 더 면접" : "면접 연습하기"}
            <motion.span
              className="flex"
              variants={{ rest: { rotate: 0 }, hover: { rotate: reduce ? 0 : -360 } }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            >
              <MaskIcon src="/review/icon-rotate-ccw.svg" size={20} className="bg-white" />
            </motion.span>
          </Link>
        </motion.span>
      </div>
    </div>
  );
}
