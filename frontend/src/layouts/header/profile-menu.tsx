"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import type { UserResponse } from "@/lib/api/types";
import { logout } from "@/lib/auth/actions";
import { ROUTES } from "@/lib/routes";

/** 프로필 사진. 사진이 없거나 못 불러오면 아래 깔린 사람 아이콘이 보인다. */
function Avatar({
  imageUrl,
  size,
  iconSize,
}: {
  imageUrl: string | null;
  size: number;
  iconSize: number;
}) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface"
      style={{ width: size, height: size }}
    >
      <MaskIcon src="/icons/user.svg" size={iconSize} className="bg-text-3" />
      {imageUrl && (
        <span
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${imageUrl}")` }}
        />
      )}
    </span>
  );
}

const menuItem =
  "group/item flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] p-3 text-[15px] leading-normal font-semibold transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none";

// Figma C01: 아바타를 누르면 오른쪽 위를 기준으로 드롭다운이 열린다. 바깥 클릭·Esc로 닫힌다.
export function ProfileMenu({ user }: { user: UserResponse }) {
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
        className={`flex cursor-pointer rounded-full ring-brand transition-shadow ${open ? "ring-2" : ""}`}
      >
        <Avatar imageUrl={user.profileImageUrl} size={36} iconSize={20} />
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
              <Avatar imageUrl={user.profileImageUrl} size={40} iconSize={20} />
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
