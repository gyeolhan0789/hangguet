"use client";

import { motion, useAnimate, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

import { MaskIcon } from "@/components/mask-icon";

// 기준: Figma S03 Action Bar(18:2106: 높이 88 · 위 테두리 · 왼쪽 [← 홈으로] · 오른쪽 [다음 →] 280px)
// · S04 같은 자리([← 지원서 선택] · [다음: 면접 방식]) · 지원서 쓰기([← 뒤로] · [저장하기], 화살표 없음) · 모션 메모 S03([다음] 회색 → 주황 채움 + scale 0.96→1 팝)
// · 모션 메모 S05(18:2492: [면접 시작]이 주황으로 채워지며 한 번 통통 scale [1,1.06,1])

/** 연습 시작 단계 화면 아래에 붙는 버튼 막대. 왼쪽은 이전으로 가는 링크, 오른쪽(children)은 다음 버튼 */
export function PracticeActionBar({
  backHref,
  backLabel,
  children,
}: {
  backHref: string;
  backLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 z-10 flex h-[88px] shrink-0 items-center justify-between gap-3 border-t border-line bg-bg px-4 sm:px-10">
      <Link
        href={backHref}
        className="flex h-14 shrink-0 items-center justify-center gap-2 rounded-[14px] bg-surface px-5 text-[17px] leading-normal font-bold tracking-[-0.2px] text-text-1"
      >
        <MaskIcon src="/practice/icon-arrow-left.svg" size={20} className="bg-text-1" />
        {backLabel}
      </Link>
      {children}
    </div>
  );
}

/**
 * 다음 단계로 가는 제출 버튼. 비활성(회색)에서 활성이 되는 순간 주황이 채워지며 팝 한다.
 * pop: settle은 0.96→1로 자리 잡기(S03 · S04 · S05-1), bounce는 [1, 1.06, 1]로 한 번 통통(S05).
 */
export function PracticeNextButton({
  children,
  disabled = false,
  pending = false,
  pop = "settle",
  arrow = true,
}: {
  children: ReactNode;
  disabled?: boolean;
  pending?: boolean;
  pop?: "settle" | "bounce";
  /** 글자 뒤 오른쪽 화살표. 지원서 쓰기 [저장하기]는 다음 단계가 아니라 화살표가 없다(Figma 지원서 쓰기) */
  arrow?: boolean;
}) {
  const [scope, animate] = useAnimate<HTMLButtonElement>();
  const reduce = useReducedMotion();
  const wasDisabled = useRef(disabled);
  const enabled = !disabled;

  useEffect(() => {
    if (wasDisabled.current && !disabled && !reduce && scope.current) {
      if (pop === "bounce") {
        // spring은 키프레임 2개만 받으므로 3개짜리 통통은 시간 기반으로 움직인다.
        animate(scope.current, { scale: [1, 1.06, 1] }, { duration: 0.4, ease: "easeOut" });
      } else {
        animate(
          scope.current,
          { scale: [0.96, 1] },
          { type: "spring", stiffness: 500, damping: 18 },
        );
      }
    }
    wasDisabled.current = disabled;
  }, [disabled, reduce, animate, scope, pop]);

  return (
    <button
      ref={scope}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`relative flex h-14 min-w-0 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-[14px] bg-surface px-6 text-[17px] leading-normal font-bold tracking-[-0.2px] transition-colors duration-300 disabled:cursor-not-allowed sm:w-[280px] sm:flex-none ${
        enabled ? "text-white" : "text-text-3"
      }`}
    >
      <motion.span
        aria-hidden
        className="absolute inset-0 origin-left bg-brand-strong"
        initial={false}
        animate={{ scaleX: enabled ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.3, ease: "easeOut" }}
      />
      <span className="relative flex items-center gap-2">
        {children}
        {arrow && <MaskIcon src="/home/icon-arrow-right.svg" size={20} />}
      </span>
    </button>
  );
}
