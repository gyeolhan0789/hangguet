"use client";

import { useAnimate, useInView, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, type RefObject } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { replayPath } from "@/lib/routes";

// 기준: Figma S07 Sticky Bar(18:2695: 높이 96 · 위 테두리 line · bg · 가운데 880 · 간격 12
// · [면접 다시보기] 폭 220 · 높이 60 · 둥글기 16 · surface · play 20 · 18 Bold
// · [오늘의 성장 리뷰 보기] 나머지 폭 · brand-strong · 흰 글자 18 Bold · arrow-right 20)
// · 기획 메모 S07(18:762: 하단 [오늘의 성장 리뷰 보기]는 스크롤해도 고정) · 기획 메모 S07-1(18:3638: S07 [면접 다시보기]로 진입)
// · 모션 메모 S07(18:2705: 하단 [오늘의 성장 리뷰 보기]는 스크롤해도 고정, 페이지 끝에 닿으면 한 번 통통)
// · 사용자 결정(2026-10-22: [오늘의 성장 리뷰 보기]는 연결할 화면이 아직 없어 누르면 아무 데도 가지 않는다)

/** 결과 화면 아래에 붙는 버튼 막대. 페이지 끝(end)이 보이면 [오늘의 성장 리뷰 보기]가 한 번 통통 튄다. */
export function ResultActionBar({
  sessionId,
  end,
}: {
  sessionId: number;
  end: RefObject<HTMLElement | null>;
}) {
  const reduce = useReducedMotion();
  // 아래 막대(높이 96)에 가려진 동안은 끝에 닿지 않은 것으로 본다.
  const reached = useInView(end, { once: true, margin: "0px 0px -96px 0px" });
  const [scope, animate] = useAnimate<HTMLButtonElement>();
  const bounced = useRef(false);

  useEffect(() => {
    if (!reached || reduce || bounced.current || !scope.current) return;
    bounced.current = true;
    // spring은 키프레임 2개만 받으므로 3개짜리 통통은 시간 기반으로 움직인다(S05 [면접 시작]과 같은 통통).
    animate(scope.current, { scale: [1, 1.06, 1] }, { duration: 0.4, ease: "easeOut" });
  }, [reached, reduce, animate, scope]);

  return (
    <div className="sticky bottom-0 z-10 shrink-0 border-t border-line bg-bg">
      <div className="mx-auto flex h-24 w-full max-w-[912px] items-center gap-3 px-4">
        <Link
          href={replayPath(sessionId)}
          className="flex h-15 shrink-0 items-center justify-center gap-2 rounded-2xl bg-surface px-4 text-base leading-[1.193] font-bold tracking-[-0.2px] text-text-1 sm:w-[220px] sm:px-5 sm:text-lg"
        >
          <MaskIcon src="/result/icon-play.svg" size={20} className="bg-text-1" />
          면접 다시보기
        </Link>
        <button
          ref={scope}
          type="button"
          className="flex h-15 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand-strong px-4 text-base leading-normal font-bold tracking-[-0.2px] text-white sm:px-6 sm:text-lg"
        >
          {/* 좁은 화면에서는 잘리지 않게 두 줄로 나눈다(모바일 설계 없음). */}
          <span className="text-center break-keep">오늘의 성장 리뷰 보기</span>
          <MaskIcon src="/home/icon-arrow-right.svg" size={20} className="bg-white" />
        </button>
      </div>
    </div>
  );
}
