"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";

import { CRITERION_LABEL, GRADE_LABEL } from "@/lib/result/format";
import type { Grade, SessionScore } from "@/types/api";

// 기준: Figma S07 Criteria(18:2645: bg-sub · 둥글기 20 · 위아래 24, 4칸 사이 세로 구분선(40 · line) · 기준 이름 14 SemiBold text-3
// · 간격 6 · 등급 22 ExtraBold — 좋아요 text-1 · 보통 text-2 · 아쉬워요 danger) · ResultResponse.sessionScores(평가 기준 4개)
// · 모션 메모 S07(18:2705: 왼쪽부터 stagger 0.08s로 평가 단어가 아래에서 떠오름, '아쉬워요'만 빨간색)
// · 기획 메모 S07(18:762: 점수 숫자 대신 '좋아요 · 보통 · 아쉬워요' 3단계)

const GRADE_COLOR: Record<Grade, string> = {
  GOOD: "text-text-1",
  NORMAL: "text-text-2",
  WEAK: "text-danger",
};

const list: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.08 } } };
const grade: Variants = { hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } };

/** 평가 기준 4칸. 좁은 화면에서는 2칸씩 두 줄로 놓는다. */
export function CriteriaScores({ scores }: Readonly<{ scores: SessionScore[] }>) {
  const reduce = useReducedMotion();
  return (
    <motion.ul
      aria-label="평가 기준"
      className="grid w-full grid-cols-2 gap-y-5 rounded-[20px] bg-bg-sub py-6 sm:flex sm:items-center"
      variants={list}
      initial={reduce ? false : "hidden"}
      animate="shown"
    >
      {scores.map((score, i) => (
        <li key={score.criterion} className="flex items-center sm:flex-1">
          {i > 0 && <span aria-hidden className="hidden h-10 w-px shrink-0 bg-line sm:block" />}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 leading-normal tracking-[-0.2px] whitespace-nowrap">
            <p className="text-sm leading-normal font-semibold text-text-3">
              {CRITERION_LABEL[score.criterion]}
            </p>
            <motion.p
              className={`text-[22px] leading-normal font-extrabold ${GRADE_COLOR[score.grade]}`}
              variants={grade}
            >
              {GRADE_LABEL[score.grade]}
            </motion.p>
          </div>
        </li>
      ))}
    </motion.ul>
  );
}
