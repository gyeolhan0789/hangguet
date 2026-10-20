"use client";

import { useAnimate, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { useToastStore } from "@/stores/toast-store";

// 기준: Figma S09 Achievements · Coming Soon(18:3075: bg-sub · line 테두리 · 둥글기 24 · 높이 400 · 배지 64 surface 3개(아이콘 24)
// · '업적' 18 ExtraBold text-2 · '추가 예정' 칩 · 15 Medium text-3) · Application · Coming Soon(18:3094: 둥글기 20 · 패딩 24/20
// · 자물쇠 48(둥글기 14) · '지원 관리' 17 ExtraBold · '개발 중' 칩 · 14 Medium text-3)
// · 기획 메모 S09(18:1173: 업적 · 지원 관리는 MVP 제외, 비활성 노출 · 클릭 불가) · 모션 메모 S09(18:3109: 클릭 시 살짝 흔들림
// + 토스트 '열심히 만들고 있어요!')

const COMING_SOON_TOAST = "열심히 만들고 있어요!";

/** 누르면 흔들리고 토스트가 뜨는 준비 중 카드. 눌러도 기능이 없다는 것을 토스트로 알리므로 누를 수는 있게 둔다. */
function ComingSoonCard({ className, children }: { className: string; children: ReactNode }) {
  const show = useToastStore((state) => state.show);
  const [scope, animate] = useAnimate<HTMLButtonElement>();
  const reduce = useReducedMotion();

  function press() {
    if (!reduce && scope.current) {
      animate(scope.current, { x: [-4, 4, -2, 2, 0] }, { duration: 0.35 });
    }
    show({ text: COMING_SOON_TOAST });
  }

  return (
    <button
      ref={scope}
      type="button"
      onClick={press}
      className={`cursor-not-allowed border border-line bg-bg-sub text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${className}`}
    >
      {children}
    </button>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-surface px-2.5 py-1 text-xs leading-normal font-bold tracking-[-0.2px] whitespace-nowrap text-text-3">
      {children}
    </span>
  );
}

const BADGES = ["/mypage/icon-badge.svg", "/mypage/icon-lock.svg", "/mypage/icon-badge.svg"];

export function AchievementsCard() {
  return (
    <ComingSoonCard className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3.5 rounded-3xl px-7 py-12 lg:h-[400px] lg:py-7">
      <span className="flex gap-3.5">
        {BADGES.map((icon, i) => (
          <span
            key={i}
            className="flex size-16 items-center justify-center rounded-full bg-surface"
          >
            <MaskIcon src={icon} size={24} className="bg-text-3" />
          </span>
        ))}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-lg leading-normal font-extrabold tracking-[-0.2px] text-text-2">
          업적
        </span>
        <Chip>추가 예정</Chip>
      </span>
      <span className="text-center text-[15px] leading-normal font-medium tracking-[-0.2px] text-text-3">
        연습할수록 쌓이는 배지를 준비하고 있어요!
      </span>
    </ComingSoonCard>
  );
}

export function ApplicationCard() {
  return (
    <ComingSoonCard className="flex w-full items-center gap-4 rounded-[20px] px-6 py-5">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-surface">
        <MaskIcon src="/mypage/icon-lock-md.svg" size={22} className="bg-text-3" />
      </span>
      <span className="flex min-w-0 flex-col gap-1 tracking-[-0.2px]">
        <span className="flex items-center gap-2">
          <span className="text-[17px] leading-normal font-extrabold text-text-2">지원 관리</span>
          <Chip>개발 중</Chip>
        </span>
        <span className="text-sm leading-normal font-medium text-text-3">
          지원한 회사와 지원서를 한곳에서 관리하는 기능을 만들고 있어요!
        </span>
      </span>
    </ComingSoonCard>
  );
}
