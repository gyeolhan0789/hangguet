"use client";

import { AnimatePresence, motion } from "motion/react";

import { useLockScroll } from "@/components/use-lock-scroll";
import type { NoticeItem } from "@/types/api";

// 기준: Figma C02 공지 모달(265:1356 모달 265:1460 · 다크 266:2219: 너비 480 · 둥글기 24 · 패딩 32 · 간격 8 · 왼쪽 정렬 · dim 라이트
// rgba(11,13,20,.65) · 다크 black/60 · 그림자 0 20 48 · 다크 1px line 테두리 · '공지' 칩(13 Bold brand-strong, 배경 brand-soft · 다크
// #3a2618) · 제목 24 Bold · 본문 16 Medium text-2 · 게시 날짜 13 Medium text-3 · [확인] 높이 52 · 둥글기 14 · brand-strong)
// · 기획 메모 C02([확인] → 8.9 공지 확인 → 닫힘. 종(C03)에서 고른 공지만 연다. '1 / 2' 같은 순번은 없다) · NoticeItem(8.8)
// · 사용자 요청(2026-10-27: 높이 상한을 두고 스크롤. 화면 위아래 16px 여백까지만 커지고 본문이 스크롤된다)

/** 2026-10-23T09:00:00+09:00 → 2026.10.23 */
export function noticeDate(startsAt: string) {
  return startsAt.slice(0, 10).replaceAll("-", ".");
}

export function NoticeModal({
  notice,
  pending = false,
  onConfirm,
}: Readonly<{
  /** 띄울 공지. null이면 닫혀 있다 */
  notice: NoticeItem | null;
  pending?: boolean;
  onConfirm: () => void;
}>) {
  useLockScroll(notice !== null);

  return (
    <AnimatePresence>
      {notice && (
        <motion.div
          key="dim"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(11,13,20,0.65)] p-4 dark:bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            key={notice.id}
            role="dialog"
            aria-modal="true"
            aria-labelledby="notice-title"
            aria-describedby="notice-content"
            className="flex max-h-full w-full max-w-[480px] flex-col gap-2 rounded-3xl bg-bg-sub p-8 shadow-[0_20px_48px_rgba(0,0,0,0.25)] dark:border dark:border-line dark:shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            {/* 화면보다 길면 이 영역만 스크롤하고 [확인]은 늘 보인다 */}
            <div className="flex min-h-0 flex-col items-start gap-2 overflow-y-auto overscroll-contain">
              <span className="rounded-full bg-brand-soft px-2.5 py-[3px] text-[13px] leading-normal font-bold text-brand-strong dark:bg-brand-strong/15">
                공지
              </span>
              <h2 id="notice-title" className="text-2xl leading-normal font-bold text-text-1">
                {notice.title}
              </h2>
              <p
                id="notice-content"
                className="w-full text-base leading-normal font-medium whitespace-pre-line text-text-2"
              >
                {notice.content}
              </p>
              <span className="text-[13px] leading-normal font-medium text-text-3">
                {noticeDate(notice.startsAt)}
              </span>
            </div>
            <button
              type="button"
              autoFocus
              onClick={onConfirm}
              disabled={pending}
              aria-busy={pending || undefined}
              className="mt-6 flex h-[52px] w-full shrink-0 cursor-pointer items-center justify-center rounded-[14px] bg-brand-strong text-base leading-normal font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed"
            >
              확인
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
