"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { applicationDate } from "@/lib/application/format";
import { applicationPath } from "@/lib/routes";
import type { ApplicationListItem } from "@/types/api";

// 기준: Figma 지원 관리 · 목록(화이트 · 다크: I02 내 문의 목록 틀 — 목록 상자 bg-sub · 둥글기 20 · 좌우 24 · 위아래 4,
// 줄 위아래 18 · 줄 사이 1px line, '회사 · 직무' 16 SemiBold · 작성일 13 Medium text-3 · 오른쪽 '›' 18 Medium text-3)
// · Swagger 4.3 ApplicationListItem(companyName · jobTitle · createdAt) · 사용자 결정(2026-10-29: '면접 N회'는 API가 없어 뺌)
// · 모션 메모 지원 관리 · 목록(첫 등장: 줄마다 y 16→0 · opacity, stagger 0.06s, 첫 진입 때 한 번만 / 줄 hover: 배경 살짝 진해지고
//   ›가 x 0→4 0.15s / 페이지 넘기기: 목록이 넘기는 방향으로 짧게 슬라이드 x ±24 · 0.2s)

export function ApplicationList({ items, page }: { items: ApplicationListItem[]; page: number }) {
  const reduce = useReducedMotion();
  // 처음 그릴 때는 줄이 차례로 떠오르고, 페이지를 넘기면 목록 전체가 넘기는 방향에서 들어온다.
  // 바뀐 page를 받은 그 렌더에서 방향을 정한다(props가 바뀔 때 state를 맞추는 React 방식).
  const [shown, setShown] = useState({ page, firstEntry: true, direction: 1 });
  if (shown.page !== page) {
    setShown({ page, firstEntry: false, direction: page < shown.page ? -1 : 1 });
  }
  const { firstEntry, direction } = shown;

  if (items.length === 0) return null;

  return (
    <motion.ul
      key={page}
      aria-label="지원서"
      className="flex w-full flex-col rounded-[20px] bg-bg-sub px-6 py-1"
      initial={reduce || firstEntry ? false : { x: 24 * direction, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {items.map((item, i) => (
        <motion.li
          key={item.id}
          className="border-b border-line last:border-b-0"
          initial={reduce || !firstEntry ? false : { y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: "easeOut", delay: i * 0.06 }}
        >
          <Link
            href={applicationPath(item.id)}
            className="group -mx-3 flex items-center justify-between gap-3 rounded-xl px-3 py-[18px] transition-colors duration-150 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-base leading-normal font-semibold text-text-1">
                {item.companyName} · {item.jobTitle}
              </span>
              <span className="text-[13px] leading-normal font-medium text-text-3">
                {applicationDate(item.createdAt)}
              </span>
            </span>
            <span
              aria-hidden
              className="shrink-0 text-lg leading-normal font-medium text-text-3 transition-transform duration-150 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
            >
              ›
            </span>
          </Link>
        </motion.li>
      ))}
    </motion.ul>
  );
}
