"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useLockScroll } from "@/components/use-lock-scroll";
import { useMediaQuery } from "@/components/use-media-query";
import { useMobileMenuStore } from "@/stores/mobile-menu-store";

import { Logo } from "./logo";
import { MobileNoticeModal } from "./mobile-menu";
import { ThemeToggle } from "./theme-toggle";

const HEADER_HEIGHT = 72;
/** Tailwind sm. 이보다 좁으면 메뉴를 햄버거 안으로 모은다 */
const DESKTOP_QUERY = "(min-width: 640px)";

interface HeaderProps {
  /**
   * true면 첫 화면(어두운 히어로) 위에 배경 없이 떠 있다가, 첫 화면을 벗어나면 배경이 생긴다(랜딩).
   * 떠 있는 동안 헤더에 `data-overlay="true"`가 붙으니, 메뉴 색은 `group-data-[overlay=true]/header:`로 바꾼다.
   */
  overlay?: boolean;
  /** 오른쪽 메뉴(sm 이상). 다크 모드 토글은 항상 그 뒤 맨 오른쪽에 붙는다. */
  children?: ReactNode;
  /** 모바일(sm 미만) 햄버거를 열면 헤더 아래로 펼쳐지는 메뉴. mobile-menu.tsx의 항목으로 채운다 */
  menu: ReactNode;
}

// Figma C/App Header · S00 Landing Nav
// 모바일(sm 미만)은 Figma 설계가 없어 사용자 결정(2026-10-26)을 따른다: 로고 + 햄버거만 두고, 기존 메뉴 · 프로필 메뉴 · 다크 모드 토글은
// 햄버거를 열면 헤더 아래 전체 폭 패널에 보인다. 바깥(dim) · Esc · 항목 선택 · 햄버거 다시 누르기로 닫힌다. sm 이상은 그대로다.
export function Header({ overlay = false, children, menu }: HeaderProps) {
  const { scrollY } = useScroll();
  const [onHero, setOnHero] = useState(overlay);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const { open: menuOpen, notice, toggle, close } = useMobileMenuStore();
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const open = menuOpen && !desktop;
  useLockScroll(open);

  useMotionValueEvent(scrollY, "change", (y) => {
    if (overlay) setOnHero(y < window.innerHeight - HEADER_HEIGHT);
  });

  // 화면이 sm 이상으로 넓어지면(패널이 숨으므로) 닫는다
  useEffect(() => {
    if (desktop) close();
  }, [desktop, close]);

  // Esc로 닫고 햄버거로 포커스를 돌린다. C02가 떠 있으면 C02 차례라 두지 않는다
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || notice) return;
      close();
      hamburgerRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, notice, close]);

  // 메뉴를 열면 히어로 위에서도 배경을 깐다
  const transparent = overlay && onHero && !open;

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
        <div className="hidden items-center gap-4 sm:flex">
          {children}
          <ThemeToggle />
        </div>
        <button
          ref={hamburgerRef}
          type="button"
          onClick={toggle}
          aria-label="메뉴"
          aria-expanded={open}
          aria-controls={open ? "mobile-menu" : undefined}
          className="-mr-2.5 flex size-11 cursor-pointer flex-col items-center justify-center gap-[5px] sm:hidden"
        >
          {[0, 1, 2].map((bar) => (
            <span
              key={bar}
              aria-hidden
              className={`h-0.5 w-[22px] rounded-full bg-text-1 transition-[transform,opacity] duration-200 ease-out group-data-[overlay=true]/header:bg-white motion-reduce:transition-none ${
                open
                  ? bar === 0
                    ? "translate-y-[7px] rotate-45"
                    : bar === 1
                      ? "opacity-0"
                      : "-translate-y-[7px] -rotate-45"
                  : ""
              }`}
            />
          ))}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <>
            {/* dim은 C02 공지 모달과 같은 색(라이트 rgba(11,13,20,.65) · 다크 black/60) */}
            <motion.div
              aria-hidden
              data-testid="mobile-menu-dim"
              onClick={close}
              className="fixed inset-x-0 top-18 bottom-0 bg-[rgba(11,13,20,0.65)] sm:hidden dark:bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
            />
            <motion.nav
              id="mobile-menu"
              aria-label="전체 메뉴"
              className="absolute inset-x-0 top-full flex max-h-[calc(100svh-72px)] flex-col gap-0.5 overflow-y-auto border-b border-line bg-bg px-3 pt-2 pb-4 sm:hidden"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
            >
              {menu}
            </motion.nav>
          </>
        )}
      </AnimatePresence>

      {/* 메뉴에서 고른 공지(C02). 메뉴가 닫혀도 남도록 패널 밖에 둔다 */}
      <MobileNoticeModal />
    </header>
  );
}
