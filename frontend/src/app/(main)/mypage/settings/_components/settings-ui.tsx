"use client";

import { motion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";

import { MaskIcon } from "@/components/mask-icon";

// 기준: Figma S09-1 설정(18:3157) 공통 모양 — 섹션 제목 14 Bold text-3(제목과 카드 사이 10) · 카드 bg-sub · 둥글기 20 · 좌우 24 · 위아래 4
// · 줄 위아래 18 · 줄 사이 1px line · 줄 제목 16 SemiBold · 화살표 chevron-right 18 text-3 · [사진 변경] 버튼(높이 40 · 좌우 16 · 둥글기 10
// · bg-sub · line 테두리 · 14 Bold) · '삭제' 글자 버튼(14 SemiBold text-3)
// · 모션 메모 S09-1(18:3261: 행 hover → 배경 살짝 진해짐 · 화살표 x 0→2)

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex w-full flex-col gap-2.5">
      <h2 className="text-sm leading-normal font-bold tracking-[-0.2px] text-text-3">{title}</h2>
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col rounded-[20px] bg-bg-sub px-6 py-1">{children}</div>;
}

export function Divider() {
  return <span aria-hidden className="h-px w-full bg-line" />;
}

/** 누를 수 있는 줄: hover면 배경이 살짝 진해지고 화살표가 오른쪽으로 2px 움직인다. */
export const pressableRow =
  "group/row -mx-3 flex w-[calc(100%+24px)] cursor-pointer items-center gap-2.5 rounded-xl px-3 py-[18px] text-left transition-colors hover:bg-surface/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function RowArrow() {
  return (
    <span className="flex transition-transform group-hover/row:translate-x-0.5">
      <MaskIcon src="/mypage/icon-chevron-right.svg" size={18} className="bg-text-3" />
    </span>
  );
}

export const rowTitle = "text-base leading-normal font-semibold tracking-[-0.2px] text-text-1";

/** [사진 변경]과 같은 모양의 작은 버튼 */
export function OutlineButton({ className = "", ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-line bg-bg-sub px-4 text-sm leading-normal font-bold tracking-[-0.2px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}

/** '삭제'와 같은 모양의 글자 버튼 */
export function TextButton({ className = "", ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={`shrink-0 cursor-pointer rounded-md text-sm leading-normal font-semibold tracking-[-0.2px] text-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}

/** 줄 아래 오류 문구(폼 오류와 같은 모양: 13 SemiBold danger) */
export function RowError({ id, children }: { id?: string; children?: string }) {
  if (!children) return null;
  return (
    <motion.p
      id={id}
      role="alert"
      className="pb-3 text-[13px] leading-normal font-semibold text-danger"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {children}
    </motion.p>
  );
}
