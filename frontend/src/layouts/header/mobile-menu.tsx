"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { logout } from "@/lib/auth/actions";
import { readNotice } from "@/lib/notice/actions";
import { useMobileMenuStore } from "@/stores/mobile-menu-store";
import type { NoticeItem } from "@/types/api";

import { NoticeRows } from "./notice-bell";
import { NoticeModal } from "./notice-modal";
import { ThemeToggle } from "./theme-toggle";

// 모바일(sm 미만) 햄버거 메뉴의 항목. Figma 모바일 설계가 없어 데스크톱 메뉴 · C01 프로필 메뉴의 글자 · 아이콘 · 색을 따른다
// (C01 menuItem: 15 SemiBold · 아이콘 18 · 마이페이지 오른쪽 chevron 16 · 둥글기 10 · hover surface).
// 사용자 결정(2026-10-26): 기존 메뉴를 모두 고를 수 있게 하고, 항목을 고르면 메뉴를 닫는다.

const row =
  "group/item flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-3 text-[15px] leading-normal font-semibold transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none";

/** 줄 사이 구분선(C01과 같다) */
export function MobileMenuDivider() {
  return <span aria-hidden className="mx-3 my-1.5 h-px shrink-0 bg-line" />;
}

/** 다른 화면으로 가는 줄. 누르면 메뉴를 닫는다 */
export function MobileMenuLink({
  href,
  icon,
  chevron = false,
  children,
}: Readonly<{
  href: string;
  /** 18 아이콘(text-2). C01 프로필 메뉴에서 온 항목만 붙인다 */
  icon?: string;
  /** C01 마이페이지처럼 오른쪽 chevron */
  chevron?: boolean;
  children: ReactNode;
}>) {
  const close = useMobileMenuStore((state) => state.close);
  return (
    <Link href={href} onClick={close} className={`${row} text-text-1`}>
      {icon && <MaskIcon src={icon} size={18} className="bg-text-2" />}
      {children}
      {chevron && (
        <span className="ml-auto flex transition-transform group-hover/item:translate-x-0.5">
          <MaskIcon src="/icons/chevron-right.svg" size={16} className="bg-text-3" />
        </span>
      )}
    </Link>
  );
}

/** 데스크톱 오른쪽 끝 다크 모드 토글 자리 */
export function MobileThemeRow() {
  return (
    <div className={`${row} cursor-default justify-between text-text-1 hover:bg-transparent`}>
      다크 모드
      <ThemeToggle />
    </div>
  );
}

/** C01 로그아웃: 확인 없이 랜딩(S00)으로 */
export function MobileLogout() {
  return (
    <form action={logout}>
      <button type="submit" className={`${row} text-text-2`}>
        <MaskIcon src="/icons/log-out.svg" size={18} className="bg-text-3" />
        로그아웃
      </button>
    </form>
  );
}

/**
 * 데스크톱 공지 종(C03) 자리. 누르면 그 자리에 공지 줄이 펼쳐지고, 공지를 고르면 메뉴를 닫고 C02로 연다(MobileNoticeModal).
 * 확인 안 한 공지가 있으면 종과 같은 brand-strong 점 8.
 */
export function MobileNotices({ notices }: Readonly<{ notices: NoticeItem[] }>) {
  const [expanded, setExpanded] = useState(false);
  const openNotice = useMobileMenuStore((state) => state.openNotice);
  const hasUnread = notices.some((notice) => !notice.read);

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={expanded ? "mobile-notices" : undefined}
        className={`${row} text-text-1`}
      >
        공지
        {hasUnread && (
          <>
            <span aria-hidden className="size-2 rounded-full bg-brand-strong" />
            <span className="sr-only">확인 안 한 공지 있음</span>
          </>
        )}
        <span
          aria-hidden
          className={`ml-auto flex transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        >
          <MaskIcon src="/icons/chevron-right.svg" size={16} className="bg-text-3" />
        </span>
      </button>
      {expanded && (
        <div id="mobile-notices" className="flex flex-col gap-0.5 pl-3">
          <NoticeRows notices={notices} onOpen={openNotice} />
        </div>
      )}
    </>
  );
}

/** 메뉴에서 고른 공지의 C02. [확인] → 8.9 → 닫힘(메모 C02 · C03, 데스크톱 NoticeBell과 같다) */
export function MobileNoticeModal() {
  const notice = useMobileMenuStore((state) => state.notice);
  const closeNotice = useMobileMenuStore((state) => state.closeNotice);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!notice) return;
    startTransition(async () => {
      await readNotice(notice.id);
      closeNotice();
    });
  }

  return <NoticeModal notice={notice} pending={pending} onConfirm={confirm} />;
}
