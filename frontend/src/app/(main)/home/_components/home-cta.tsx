"use client";

import { motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";

/** 홈 CTA (Figma S02 CTA). hover하면 화살표가 오른쪽으로 살짝 반복해서 움직인다. */
export function HomeCta({
  href,
  label,
  caption,
  variant = "primary",
}: {
  href: string;
  label: string;
  caption?: string;
  /** secondary: 오늘 할 일을 마친 뒤의 약한 버튼(S02-B) */
  variant?: "primary" | "secondary";
}) {
  const primary = variant === "primary";
  return (
    <div className="flex w-full max-w-[440px] flex-col items-center gap-3">
      <motion.span className="w-full" initial="rest" animate="rest" whileHover="hover">
        <Link
          href={href}
          className={`flex h-16 w-full items-center justify-center gap-2 rounded-2xl px-6 text-[19px] leading-normal font-bold ${
            primary ? "bg-brand-strong text-white" : "bg-surface text-text-1"
          }`}
        >
          {label}
          {primary && (
            <motion.span
              className="flex"
              variants={{
                rest: { x: 0 },
                hover: { x: [0, 4, 0], transition: { duration: 0.6, repeat: Infinity } },
              }}
            >
              <Image src="/home/icon-arrow-right.svg" alt="" width={20} height={20} />
            </motion.span>
          )}
        </Link>
      </motion.span>
      {caption && <p className="text-[15px] leading-normal font-medium text-text-3">{caption}</p>}
    </div>
  );
}
