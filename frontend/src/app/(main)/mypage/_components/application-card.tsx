import Link from "next/link";

import { MaskIcon } from "@/components/mask-icon";
import { ROUTES } from "@/lib/routes";

// 기준: Figma S09 Application · Coming Soon(18:3094: 둥글기 20 · 패딩 24/20 · 아이콘 상자 48(둥글기 14) · '지원 관리' 17 ExtraBold
// · 14 Medium text-3) · 기획 메모 지원 관리(들어오는 곳: S09 '지원 관리' 카드)
// · 사용자 결정(2026-10-29: 카드를 켜서 지원 관리 목록으로 연결, '개발 중' 칩 · 자물쇠 · 흔들림 토스트는 뺌)

export function ApplicationCard() {
  return (
    <Link
      href={ROUTES.applications}
      className="group flex w-full items-center gap-4 rounded-[20px] border border-line bg-bg-sub px-6 py-5 transition-colors duration-150 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-surface group-hover:bg-bg-sub">
        <MaskIcon src="/mypage/icon-briefcase.svg" size={22} className="bg-text-2" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 tracking-[-0.2px]">
        <span className="text-[17px] leading-normal font-extrabold text-text-1">지원 관리</span>
        <span className="text-sm leading-normal font-medium text-text-3">
          지원한 회사와 지원서를 한곳에서 관리해요
        </span>
      </span>
      <MaskIcon src="/mypage/icon-chevron-right.svg" size={20} className="bg-text-3" />
    </Link>
  );
}
