"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { pendingLabel, sessionMeta } from "@/lib/records/format";
import { recordsPath, replayPath, resultPath } from "@/lib/routes";
import type { SessionListItem, SessionListResponse } from "@/types/api";

// 기준: Figma 연습 기록 초안 Interview List(232:843: bg-sub · 둥글기 24 · 패딩 위 28 · 좌우 28 · 아래 20 · '면접 목록' 18 ExtraBold
// · 구분선 line · 줄 위아래 22 · 회사 · 직무 17 ExtraBold · '악마 면접관 · 화상 · 20분' 14 SemiBold text-3 · 한 줄 총평 15 Medium text-2
// · [상세 피드백] brand-soft · brand-ink · [다시보기] surface · 높이 40 · 둥글기 12 · 아이콘 16 · 14 Bold
// · '분석 중' loader 14 + 13 Bold text-3 · 아래 가운데 ‹ 1 / 1 › 14 SemiBold text-2)
// · 웹 Swagger 5.13(content · page · summary) · COMPLETED만 [상세 피드백] · [다시보기], ANALYZING · FAILED는 상태
// 안내만, 총평이 null이면 숨김, 범위를 넘는 페이지는 빈 날짜와 구분하고 첫 페이지 복귀 링크
// · 모션 메모 연습 기록(목록 스크롤은 쫀득한(스프링) 애니메이션)
// · 사용자 결정(2026-10-23: 빈 날 '이날은 면접 기록이 없어요', 범위를 넘으면 '이 페이지에는 기록이 없어요' + [첫 페이지로], 실패는 '분석 실패')

/** 줄이 스크롤로 들어올 때의 스프링(모션 메모: 쫀득하게) */
const ROW_SPRING = { type: "spring", stiffness: 420, damping: 22, mass: 0.8 } as const;

export function InterviewList({
  date,
  list,
}: Readonly<{ date: string; list: SessionListResponse }>) {
  const reduce = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const { content, page } = list;
  const outOfRange = content.length === 0 && page.totalElements > 0;

  return (
    <section
      aria-labelledby="interview-list-title"
      className="flex min-h-[320px] flex-1 flex-col rounded-3xl bg-bg-sub px-5 pt-6 pb-5 sm:px-7 sm:pt-7 lg:absolute lg:inset-0"
    >
      <h2
        id="interview-list-title"
        className="pb-4 text-lg leading-normal font-extrabold tracking-[-0.2px] text-text-1"
      >
        면접 목록
      </h2>
      <span aria-hidden className="h-px w-full shrink-0 bg-line" />

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {content.length > 0 ? (
          <ul>
            {content.map((item, i) => (
              <motion.li
                key={item.id}
                className={i > 0 ? "border-t border-line" : undefined}
                initial={reduce ? false : { opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ root: scroller, once: true }}
                transition={{ ...ROW_SPRING, delay: reduce ? 0 : Math.min(i, 4) * 0.05 }}
              >
                <Row item={item} />
              </motion.li>
            ))}
          </ul>
        ) : (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 text-center">
            <p className="text-[15px] leading-normal font-medium tracking-[-0.2px] text-text-3">
              {outOfRange ? "이 페이지에는 기록이 없어요" : "이날은 면접 기록이 없어요"}
            </p>
            {outOfRange && (
              <Link
                href={recordsPath(date)}
                scroll={false}
                className="flex h-10 items-center rounded-xl bg-surface px-3.5 text-sm leading-normal font-bold tracking-[-0.2px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                첫 페이지로
              </Link>
            )}
          </div>
        )}
      </div>

      {/* 범위를 넘은 페이지는 [첫 페이지로]로 돌아가게 하고 번호는 보이지 않는다. */}
      {page.totalPages > 0 && !outOfRange && (
        <nav aria-label="페이지" className="flex items-center justify-center gap-3 pt-4">
          <PageLink
            date={date}
            page={page.number - 1}
            last={page.totalPages - 1}
            label="이전 페이지"
            icon="/mypage/icon-chevron-left.svg"
          />
          <span className="text-sm leading-normal font-semibold tracking-[-0.2px] text-text-2">
            {page.number + 1} / {page.totalPages}
          </span>
          <PageLink
            date={date}
            page={page.number + 1}
            last={page.totalPages - 1}
            label="다음 페이지"
            icon="/mypage/icon-chevron-right.svg"
          />
        </nav>
      )}
    </section>
  );
}

function Row({ item }: Readonly<{ item: SessionListItem }>) {
  const pending = pendingLabel(item);
  return (
    <article
      aria-label={`${item.companyName} ${item.jobTitle}`}
      className={`flex flex-col gap-3 py-[22px] sm:flex-row sm:gap-4 ${pending ? "sm:items-center" : "sm:items-start"}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="text-[17px] leading-normal font-extrabold tracking-[-0.2px] break-keep text-text-1">
          {item.companyName} · {item.jobTitle}
        </h3>
        <p className="text-sm leading-normal font-semibold tracking-[-0.2px] text-text-3">
          {sessionMeta(item)}
        </p>
        {!pending && item.summary && (
          <p className="pt-2.5 text-[15px] leading-normal font-medium tracking-[-0.2px] break-keep text-text-2">
            {item.summary}
          </p>
        )}
      </div>
      {pending ? (
        <p className="flex shrink-0 items-center gap-1 text-[13px] leading-normal font-bold tracking-[-0.2px] text-text-3">
          {item.status === "ANALYZING" && (
            <MaskIcon src="/interview/icon-loader-circle.svg" size={14} className="bg-current" />
          )}
          {pending}
        </p>
      ) : (
        <div className="flex shrink-0 gap-2">
          <Link
            href={resultPath(item.id)}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-brand-soft px-3.5 text-sm leading-normal font-bold tracking-[-0.2px] text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:bg-brand-soft/8"
          >
            <MaskIcon src="/home/icon-file-text.svg" size={16} className="bg-current" />
            상세 피드백
          </Link>
          <Link
            href={replayPath(item.id)}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-surface px-3.5 text-sm leading-normal font-bold tracking-[-0.2px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <MaskIcon src="/result/icon-play.svg" size={16} className="bg-current" />
            다시보기
          </Link>
        </div>
      )}
    </article>
  );
}

function PageLink({
  date,
  page,
  last,
  label,
  icon,
}: Readonly<{
  date: string;
  page: number;
  last: number;
  label: string;
  icon: string;
}>) {
  if (page < 0 || page > last) {
    return (
      <span aria-hidden className="flex">
        <MaskIcon src={icon} size={18} className="bg-text-3" />
      </span>
    );
  }
  return (
    <Link
      href={recordsPath(date, page)}
      scroll={false}
      aria-label={label}
      className="flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <MaskIcon src={icon} size={18} className="bg-text-2" />
    </Link>
  );
}
