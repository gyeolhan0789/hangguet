"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { useLockScroll } from "@/components/use-lock-scroll";
import type { InquiryStatus } from "@/types/api";

import {
  inquiryButtonClass,
  type InquiryButtonKind,
  type InquiryButtonSize,
} from "./inquiry-button-class";

// 기준: Figma 화이트모드 I01 ~ I04 · 다크모드(Color 변수 Light/Dark) 공통 모양
// · 본문 위 40 · 가운데 720(I04는 400) · 간격 28(S09-1과 같은 틀)
// · 머리: '‹ 돌아갈 곳'(chevron-left 18 + 15 SemiBold text-3, 간격 4) · 제목 32 ExtraBold · 설명 15 Medium text-3(간격 8)
// · 버튼: 기본 높이 54 · 둥글기 14 · 17 Bold / 작은 버튼 높이 44 · 둥글기 12 · 15 Bold, 주 버튼 brand-strong · 보조 버튼 bg-sub + line 테두리 text-2
// · 상태 칩: 13 Bold · 위아래 3 · 좌우 10 · 둥글기 999, 답변함 brand-soft/brand-strong · 답변 대기 surface/text-2 · 종료 surface/text-3
// · 모달: dim rgba(11,13,20,.65)(다크 black/60) · bg-sub · 둥글기 24 · 패딩 32 · 간격 8 · 그림자 0 20 48(.25, 다크 .45) · 다크 1px line 테두리

export const STATUS_LABEL: Record<InquiryStatus, string> = {
  WAITING: "답변 대기",
  ANSWERED: "답변함",
  CLOSED: "종료",
};

const STATUS_CLASS: Record<InquiryStatus, string> = {
  WAITING: "bg-surface text-text-2",
  ANSWERED: "bg-brand-soft text-brand-strong dark:bg-brand-soft/8",
  CLOSED: "bg-surface text-text-3",
};

export function StatusChip({ status }: { status: InquiryStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2.5 py-[3px] text-[13px] leading-normal font-bold ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** 본문 틀(S09-1과 같은 위치 · 너비) */
export function InquiryPage({
  narrow = false,
  children,
}: {
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`mx-auto flex w-full flex-col gap-7 px-4 pt-10 pb-16 ${narrow ? "max-w-[432px]" : "max-w-[752px]"}`}
    >
      {children}
    </div>
  );
}

const backClass =
  "flex w-fit items-center gap-1 rounded-md text-[15px] leading-normal font-semibold text-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function InquiryHead({
  back,
  title,
  sub,
  children,
}: {
  /** 돌아갈 곳. href면 링크, onClick이면 같은 화면 안에서 돌아간다(비회원 I03 → I04) */
  back?: { label: string; href?: string; onClick?: () => void };
  title: string;
  sub?: string;
  /** 제목 아래 줄(문의번호 · 상태) */
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {back?.href && (
        <Link href={back.href} className={backClass}>
          <MaskIcon src="/mypage/icon-chevron-left.svg" size={18} className="bg-text-3" />
          {back.label}
        </Link>
      )}
      {back?.onClick && (
        <button type="button" onClick={back.onClick} className={`cursor-pointer ${backClass}`}>
          <MaskIcon src="/mypage/icon-chevron-left.svg" size={18} className="bg-text-3" />
          {back.label}
        </button>
      )}
      <h1 className="text-[32px] leading-[1.3] font-extrabold break-words text-text-1">{title}</h1>
      {sub && (
        <p className="text-[15px] leading-normal font-medium whitespace-pre-line text-text-3">
          {sub}
        </p>
      )}
      {children}
    </div>
  );
}

export function InquiryButton({
  kind,
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { kind: InquiryButtonKind; size?: InquiryButtonSize }) {
  return (
    <button type="button" {...props} className={`${inquiryButtonClass(kind, size)} ${className}`} />
  );
}

/** react-hook-form `register()` 결과를 펼쳐 넣는 여러 줄 입력칸(입력칸과 같은 테두리 · 둥글기 12 · 15) */
export function TextArea({
  invalid = false,
  heightClass,
  ...props
}: ComponentProps<"textarea"> & { invalid?: boolean; heightClass: string }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      aria-describedby={props.id ? `${props.id}-message` : undefined}
      className={`w-full resize-none rounded-xl border bg-bg-sub px-4 py-3.5 text-[15px] leading-normal font-semibold text-text-1 transition-colors outline-none placeholder:font-medium placeholder:text-text-3 focus:border-brand focus:ring-1 focus:ring-brand ${
        invalid ? "border-danger ring-1 ring-danger" : "border-line"
      } ${heightClass}`}
      {...props}
    />
  );
}

/** I01-1 · I03-1 모달 틀 */
export function InquiryModal({
  open,
  labelledBy,
  width,
  children,
}: {
  open: boolean;
  labelledBy: string;
  width: "w-[440px]" | "w-[480px]";
  children: ReactNode;
}) {
  useLockScroll(open);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="dim"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(11,13,20,0.65)] px-4 dark:bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className={`flex max-w-full flex-col gap-2 rounded-3xl bg-bg-sub p-8 shadow-[0_20px_48px_rgba(0,0,0,0.25)] dark:border dark:border-line dark:shadow-[0_20px_48px_rgba(0,0,0,0.45)] ${width}`}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
