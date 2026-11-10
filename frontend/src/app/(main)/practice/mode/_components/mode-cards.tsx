"use client";

import { motion, useReducedMotion } from "motion/react";

import { MaskIcon } from "@/components/mask-icon";
import { MODES, type ModeInfo } from "@/lib/interview/modes";
import type { Mode } from "@/types/api";

import { ModeIcon } from "./mode-icon";

// 기준: Figma S05-1 Options(18:2269: 카드 두 개 · 간격 20) · 고른 카드(18:2270: brand-soft · 2px brand 테두리 · 여백 28 · 둥근 24)
// · 안 고른 카드(18:2290: bg-sub · 테두리 없음) · 모션 메모 S05-1(카드 선택: 주황 테두리 layoutId로 이전 카드에서 미끄러지듯 이동)

function ModeCard({
  info,
  checked,
  onSelect,
}: Readonly<{
  info: ModeInfo;
  checked: boolean;
  onSelect: (mode: Mode) => void;
}>) {
  const reduce = useReducedMotion();

  return (
    <label
      // 고른 카드는 Figma처럼 2px 테두리만큼 안쪽 여백이 커진다(18:2270: 테두리 2 + 여백 28).
      // 두 카드는 flex-1 · basis-0이라 여백을 뺀 남는 폭을 똑같이 나눈다: 안쪽 폭은 같고 고른 카드만 4px 넓다(392 · 388).
      // 고른 카드의 배경은 brand-soft 하나뿐이라 bg-sub를 빼되, 선택 테두리가 미끄러져 올 때까지 서서히 빠지게 한다.
      className={`relative flex cursor-pointer flex-col gap-4 rounded-3xl transition-colors duration-300 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand sm:flex-1 sm:basis-0 ${checked ? "p-[22px] sm:p-[30px]" : "bg-bg-sub p-5 sm:p-7"}`}
    >
      {checked && (
        // 미끄러지는 동안 다른 카드 글자를 덮지 않도록 카드 내용보다 뒤(-z)에 그린다(fieldset이 isolate).
        <motion.span
          layoutId="mode-selected"
          aria-hidden
          className="absolute inset-0 -z-10 rounded-3xl border-2 border-brand bg-brand-soft dark:bg-brand-soft/8"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      <input
        type="radio"
        name="mode"
        value={info.mode}
        checked={checked}
        onChange={() => onSelect(info.mode)}
        className="sr-only"
      />
      <span className="relative flex items-center justify-between">
        <ModeIcon mode={info.mode} active={checked} />
        <span
          aria-hidden
          className={`flex size-[26px] shrink-0 items-center justify-center rounded-full ${checked ? "bg-brand-strong" : "border-2 border-line bg-bg-sub"}`}
        >
          {checked && (
            <motion.span
              className="size-2.5 rounded-full bg-white"
              initial={reduce ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
            />
          )}
        </span>
      </span>
      <span className="relative text-2xl leading-normal font-extrabold tracking-[-0.2px] text-text-1">
        {info.title}
      </span>
      <span className="relative flex flex-col text-base leading-[1.6] font-medium tracking-[-0.2px] text-text-2">
        <span>{info.description[0]}</span>
        <span>{info.description[1]}</span>
      </span>
      <span className="relative flex flex-wrap gap-2">
        {info.chips.map(({ icon, label }) => (
          <span
            key={label}
            className="flex items-center gap-1.5 rounded-full bg-bg-sub px-3 py-1.5 text-[13px] leading-normal font-semibold tracking-[-0.2px] whitespace-nowrap text-text-2"
          >
            <MaskIcon src={icon} size={14} className="bg-text-2" />
            {label}
          </span>
        ))}
      </span>
    </label>
  );
}

export function ModeCards({
  selected,
  onSelect,
}: Readonly<{
  selected: Mode | null;
  onSelect: (mode: Mode) => void;
}>) {
  return (
    <fieldset className="isolate flex flex-col gap-5 sm:flex-row sm:items-start">
      <legend className="sr-only">면접 방식</legend>
      {MODES.map((info) => (
        <ModeCard
          key={info.mode}
          info={info}
          checked={selected === info.mode}
          onSelect={onSelect}
        />
      ))}
    </fieldset>
  );
}
