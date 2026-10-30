"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/avatar";
import { MaskIcon } from "@/components/mask-icon";
import type { MeResponse } from "@/types/api";
import { logout } from "@/lib/auth/actions";
import { ROUTES } from "@/lib/routes";

const menuItem =
  "group/item flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] p-3 text-[15px] leading-normal font-semibold transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none";

// Figma C01: 아바타를 누르면 오른쪽 위를 기준으로 드롭다운이 열린다. 바깥 클릭·Esc로 닫힌다.
export function ProfileMenu({ user }: { user: MeResponse }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !rootRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="프로필 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex cursor-pointer rounded-full"
      >
        <Avatar imageUrl={user.profileImageUrl} size={36} icon="/icons/user.svg" iconSize={20} />
        {/* Figma C01(18:3110): 열리면 아바타 36 안쪽에 2px brand 테두리(바깥으로 커지지 않는다) */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-full border-2 border-brand transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="absolute top-[calc(100%+24px)] -right-4 flex w-60 origin-top-right flex-col gap-0.5 rounded-2xl border border-line bg-bg-sub p-2 shadow-[0_12px_16px_rgba(25,33,40,0.15)]"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <div className="flex items-center gap-3 p-3">
              <Avatar
                imageUrl={user.profileImageUrl}
                size={40}
                icon="/icons/user-round.svg"
                iconSize={20}
              />
              <div className="flex min-w-0 flex-col leading-normal">
                <span className="truncate text-[15px] font-extrabold text-text-1">
                  {user.nickname}
                </span>
                <span className="truncate text-[13px] font-medium text-text-3">{user.email}</span>
              </div>
            </div>
            <span className="h-px bg-line" aria-hidden />
            <Link
              role="menuitem"
              href={ROUTES.mypage}
              onClick={() => setOpen(false)}
              className={`${menuItem} text-text-1`}
            >
              <MaskIcon src="/icons/user-round.svg" size={18} className="bg-text-2" />
              마이페이지
              <span className="ml-auto flex transition-transform group-hover/item:translate-x-0.5">
                <MaskIcon src="/icons/chevron-right.svg" size={16} className="bg-text-3" />
              </span>
            </Link>
            {/* 사용자 결정(2026-10-29): 마이페이지 아래에 지원 관리 목록으로 가는 줄. Figma C01에는 없어 문의하기 줄과 같은 모양
                (아이콘 18 text-2 · 글자 text-1 · 화살표 없음), 아이콘은 S09 지원 관리 카드의 briefcase */}
            <Link
              role="menuitem"
              href={ROUTES.applications}
              onClick={() => setOpen(false)}
              className={`${menuItem} text-text-1`}
            >
              <MaskIcon src="/mypage/icon-briefcase.svg" size={18} className="bg-text-2" />
              지원 관리
            </Link>
            {/* Figma C01(18:3110 Menu 문의하기 · I02): 마이페이지 아래, message-circle 18 text-2 · 글자 text-1 · 화살표 없음 */}
            <Link
              role="menuitem"
              href={ROUTES.inquiries}
              onClick={() => setOpen(false)}
              className={`${menuItem} text-text-1`}
            >
              <MaskIcon src="/icons/message-circle.svg" size={18} className="bg-text-2" />
              문의하기
            </Link>
            {/* 로그아웃: 확인 없이 랜딩(S00)으로 */}
            <form action={logout}>
              <button type="submit" role="menuitem" className={`${menuItem} text-text-2`}>
                <MaskIcon src="/icons/log-out.svg" size={18} className="bg-text-3" />
                로그아웃
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
