"use client";

import { motion } from "motion/react";
import Image from "next/image";
import type { ComponentProps, ReactNode } from "react";

/** Figma S01-1 Check: 22px 주황 상자 + 흰 체크. 체크되면 살짝 튄다. */
export function Checkbox({
  checked,
  children,
  delay = 0,
  className = "",
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  checked: boolean;
  children: ReactNode;
  /** 체크 표시가 튀는 시점을 늦춘다(전체 동의 시 차례로 체크) */
  delay?: number;
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-2.5 ${className}`}>
      <input type="checkbox" checked={checked} className="peer sr-only" {...props} />
      <span
        aria-hidden
        className={`flex size-[22px] shrink-0 items-center justify-center rounded-md border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${
          checked ? "border-brand-strong bg-brand-strong" : "border-line bg-bg-sub"
        }`}
      >
        <motion.span
          initial={false}
          animate={checked ? { scale: [0.6, 1.15, 1], opacity: 1 } : { scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.25, delay: checked ? delay : 0 }}
          className="flex"
        >
          <Image src="/auth/icon-check-box.svg" alt="" width={14} height={14} />
        </motion.span>
      </span>
      {children}
    </label>
  );
}
