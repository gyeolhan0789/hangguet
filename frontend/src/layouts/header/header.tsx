"use client";

import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState, type ReactNode } from "react";

import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const HEADER_HEIGHT = 72;

interface HeaderProps {
  /**
   * true면 첫 화면(어두운 히어로) 위에 배경 없이 떠 있다가, 첫 화면을 벗어나면 배경이 생긴다(랜딩).
   * 떠 있는 동안 헤더에 `data-overlay="true"`가 붙으니, 메뉴 색은 `group-data-[overlay=true]/header:`로 바꾼다.
   */
  overlay?: boolean;
  /** 오른쪽 메뉴. 다크 모드 토글은 항상 그 뒤 맨 오른쪽에 붙는다. */
  children?: ReactNode;
}

// Figma C/App Header · S00 Landing Nav
export function Header({ overlay = false, children }: HeaderProps) {
  const { scrollY } = useScroll();
  const [onHero, setOnHero] = useState(overlay);

  useMotionValueEvent(scrollY, "change", (y) => {
    if (overlay) setOnHero(y < window.innerHeight - HEADER_HEIGHT);
  });

  const transparent = overlay && onHero;

  return (
    <header
      data-overlay={transparent}
      className={`group/header inset-x-0 top-0 z-50 h-18 ${overlay ? "fixed" : "sticky"}`}
    >
      <motion.div
        aria-hidden
        className="absolute inset-0 border-b border-line bg-bg"
        initial={false}
        animate={{ opacity: transparent ? 0 : 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      />
      <div className="relative flex h-full items-center justify-between px-5 sm:px-10">
        <Logo />
        <div className="flex items-center gap-4">
          {children}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
