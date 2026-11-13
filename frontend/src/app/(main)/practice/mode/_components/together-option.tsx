"use client";

import { motion } from "motion/react";
import { useId } from "react";

import { MaskIcon } from "@/components/mask-icon";

// 기준: Figma [초안] S05-1 면접 방식 선택 · 함께 보기(488:2636: 카드 · 아이콘 타일 48 · '친구와 함께 볼래요' 18 Bold · 설명 14 Medium)
// · 사용자 결정(2026-11-13: 화상 · 채팅을 고른 뒤 함께 볼지는 켜고 끄는 토글로 고른다. 카드 어디를 눌러도 켜고 끈다.
//   스위치 모양은 S09-1 연습 알림 스위치와 같다) · BE Swagger 10.1(정원 2 · 3)

export function TogetherOption({
  checked,
  onChange,
}: Readonly<{ checked: boolean; onChange: (checked: boolean) => void }>) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    // 카드 전체가 스위치다(방식 카드처럼 어디를 눌러도 된다).
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={() => onChange(!checked)}
      // 켜면 Figma 488:2636 Checked(2px brand 테두리 · brand-soft). 테두리 2px만큼 여백을 줄여 크기는 그대로 둔다.
      className={`flex w-full cursor-pointer items-center gap-4 rounded-3xl text-left transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        checked
          ? "border-2 border-brand bg-brand-soft px-[18px] py-[14px] sm:px-[26px] sm:py-[18px] dark:bg-brand-soft/8"
          : "bg-bg-sub px-5 py-4 sm:px-7 sm:py-5"
      }`}
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-bg-sub">
        <MaskIcon src="/practice/icon-users.svg" size={24} className="bg-brand-ink" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 leading-normal">
        <span id={titleId} className="text-lg font-bold text-text-1">
          친구와 함께 볼래요
        </span>
        <span id={descriptionId} className="text-sm font-medium text-text-2">
          2~3명이 같은 면접관에게 돌아가며 답해요 · 초대 링크로 모여요
        </span>
      </span>
      <span
        aria-hidden
        className={`flex h-[26px] w-11 shrink-0 items-center rounded-full p-[3px] transition-colors ${
          checked ? "justify-end bg-brand-strong" : "justify-start bg-line"
        }`}
      >
        <motion.span layout className="size-5 rounded-full bg-white" />
      </span>
    </button>
  );
}
