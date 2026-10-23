"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useTransition } from "react";

import { MaskIcon } from "@/components/mask-icon";
import type { NoticeItem } from "@/types/api";
import { readNotice } from "@/lib/notice/actions";

import { NoticeModal, noticeDate } from "./notice-modal";

// 기준: Figma C/App Header 공지 버튼(17:42 Notice Bell: 36 원 · 종 아이콘 20 text-3 · 확인 안 한 공지가 있으면 brand-strong 점 8)
// · C03 공지 목록 펼침(265:1502 드롭다운 265:1638 · 다크 266:2356: 너비 340 · 둥글기 16 · line 테두리 · 패딩 8 · 그림자 0 12 32 · '공지'
// 15 Bold · 줄마다 점 + 제목 15(확인 안 함 SemiBold text-1 · 확인함 Medium text-3) + 'YYYY.MM.DD · 확인 안 함/확인함' 13 Medium text-3,
// 오른쪽 끝은 종보다 24 바깥, 펼치면 종에 bg-sub 채움 · 1.5px brand-strong 테두리)
// · 기획 메모 C01(다크 모드 토글 바로 왼쪽) · C03(종 → 펼침, 공지를 누르면 C02로 그 공지를 연다 → [확인] 8.9 → 확인함으로,
// 공지가 없으면 '공지가 없어요', 바깥 클릭 · Esc로 닫힘) · Swagger 8.8 NoticesResponse · 8.9 공지 확인

export function NoticeBell({ notices }: { notices: NoticeItem[] }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState<NoticeItem | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const hasUnread = notices.some((notice) => !notice.read);

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

  // 메모 C03: [확인] → 8.9. 이미 확인한 공지도 서버는 204로 답한다
  function confirm() {
    const notice = opened;
    if (!notice) return;
    startTransition(async () => {
      await readNotice(notice.id);
      setOpened(null);
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={hasUnread ? "공지, 확인 안 한 공지 있음" : "공지"}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`relative flex size-9 cursor-pointer items-center justify-center rounded-full ${open ? "bg-bg-sub" : ""}`}
      >
        <MaskIcon src="/icons/bell.svg" size={20} className="bg-text-3" />
        {hasUnread && (
          <span
            aria-hidden
            data-testid="notice-unread-dot"
            className="absolute top-[7px] right-[7px] size-2 rounded-full bg-brand-strong ring-[1.5px] ring-bg"
          />
        )}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-full border-[1.5px] border-brand-strong transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="공지"
            className="absolute top-[calc(100%+24px)] -right-6 flex w-[min(340px,calc(100vw-32px))] origin-top-right flex-col gap-0.5 rounded-2xl border border-line bg-bg-sub p-2 shadow-[0_12px_32px_rgba(0,0,0,0.15)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.4)]"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <span className="px-3 py-2.5 text-[15px] leading-normal font-bold text-text-1">
              공지
            </span>
            <span className="h-px bg-line" aria-hidden />
            {notices.length === 0 ? (
              <span className="p-3 text-[15px] leading-normal font-medium text-text-3">
                공지가 없어요
              </span>
            ) : (
              notices.map((notice) => (
                <button
                  key={notice.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setOpened(notice);
                  }}
                  className="flex w-full cursor-pointer items-start gap-2.5 rounded-[10px] p-3 text-left transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
                >
                  <span className="flex h-[22px] w-2 shrink-0 items-center" aria-hidden>
                    {!notice.read && <span className="size-2 rounded-full bg-brand-strong" />}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5 tracking-[-0.2px]">
                    <span
                      className={`truncate text-[15px] leading-normal ${notice.read ? "font-medium text-text-3" : "font-semibold text-text-1"}`}
                    >
                      {notice.title}
                    </span>
                    <span className="text-[13px] leading-normal font-medium text-text-3">
                      {noticeDate(notice.startsAt)} · {notice.read ? "확인함" : "확인 안 함"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <NoticeModal notice={opened} pending={pending} onConfirm={confirm} />
    </div>
  );
}
