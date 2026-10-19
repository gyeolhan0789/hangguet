"use client";

import { motion } from "motion/react";

import { MaskIcon } from "@/components/mask-icon";

const STEPS = [
  { icon: "/home/icon-file-text.svg", title: "1. 지원서 입력", desc: "회사 · 직무 · 자소서" },
  { icon: "/home/icon-mic.svg", title: "2. 3D 면접관과 면접", desc: "말로 묻고 답하기" },
  { icon: "/home/icon-sparkles.svg", title: "3. 성장 리뷰", desc: "오늘 나아진 점 확인" },
] as const;

// Figma S02-D Steps · 모션 메모: 아래에서 stagger 0.08s로 등장, hover 시 아이콘 통통
export function FirstSteps() {
  return (
    <ol className="grid w-full max-w-[1120px] gap-5 sm:grid-cols-3">
      {STEPS.map((step, i) => (
        <motion.li
          key={step.title}
          className="group flex items-center gap-3.5 rounded-[20px] bg-bg-sub p-5"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut", delay: 0.2 + i * 0.08 }}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-bg-sub transition-transform group-hover:-translate-y-0.5">
            <MaskIcon src={step.icon} size={20} className="bg-brand-ink" />
          </span>
          <span className="flex flex-col gap-0.5 leading-normal">
            <span className="text-[17px] font-extrabold text-text-1">{step.title}</span>
            <span className="text-sm font-medium text-text-2">{step.desc}</span>
          </span>
        </motion.li>
      ))}
    </ol>
  );
}
