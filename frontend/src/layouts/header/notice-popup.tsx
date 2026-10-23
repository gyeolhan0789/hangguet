"use client";

import { useState, useTransition } from "react";

import type { NoticeItem } from "@/types/api";
import { readNotice } from "@/lib/notice/actions";

import { NoticeModal } from "./notice-modal";

// 기준: 기획 메모 C02(앱에 들어오면 8.8 공지 목록 중 확인 안 함(read false)인 공지를 최신순으로 한 장씩 띄운다 · [확인] → 8.9 → 다음
// 확인 안 한 공지, 마지막이면 닫힘 · 확인한 공지는 앱에 들어올 때 다시 뜨지 않는다) · Swagger 8.8(최신순) · 8.9

/** 앱에 들어왔을 때의 확인 안 한 공지를 차례대로 띄운다. 띄울 차례는 처음 받은 목록으로 정하고, 확인 뒤 다시 그려져도 바꾸지 않는다. */
export function NoticePopup({ notices }: { notices: NoticeItem[] }) {
  const [queue] = useState(() => notices.filter((notice) => !notice.read));
  const [index, setIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const current = queue[index] ?? null;

  function confirm() {
    if (!current) return;
    startTransition(async () => {
      await readNotice(current.id);
      setIndex((i) => i + 1);
    });
  }

  return <NoticeModal notice={current} pending={pending} onConfirm={confirm} />;
}
