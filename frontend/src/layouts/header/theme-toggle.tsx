"use client";

import Image from "next/image";

import { toggleTheme } from "@/lib/theme";

// Figma C/Theme Toggle (Mode=Light/Dark).
// 현재 테마는 <html data-theme>에만 있어서, 첫 페인트부터 맞게 보이도록 위치·아이콘을 dark: 변형으로 그린다.
export function ThemeToggle() {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="라이트·다크 모드 전환"
      className="flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full bg-surface p-[3px]"
    >
      <span className="flex size-[26px] items-center justify-center rounded-full bg-bg-sub shadow-[0_1px_3px_rgba(0,0,0,0.16)] transition-transform duration-200 ease-out motion-reduce:transition-none dark:translate-x-6">
        <Image src="/icons/sun.svg" alt="" width={16} height={16} className="dark:hidden" />
        <Image src="/icons/moon.svg" alt="" width={16} height={16} className="hidden dark:block" />
      </span>
    </button>
  );
}
