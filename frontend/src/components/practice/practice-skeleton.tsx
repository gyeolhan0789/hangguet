import type { ReactNode } from "react";

import { PracticeSteps, type PracticeStep } from "./practice-steps";

/** 스켈레톤 덩어리 색(S02 Home Skeleton과 같음) */
export const bone = "bg-surface";

// 연습 시작 단계 화면이 데이터(4.2 등)를 불러오는 동안. Figma에는 단계 화면의 로딩 화면이 없어,
// 실제 화면과 같은 자리에 S02 스켈레톤처럼 회색 덩어리를 둔다. children은 목록 · 카드 자리다.
export function PracticeSkeleton({
  current,
  width,
  children,
}: Readonly<{
  current: PracticeStep;
  /** 본문 최대 폭(Figma Content 폭) */
  width: string;
  children: ReactNode;
}>) {
  return (
    <div aria-hidden className="flex flex-1 flex-col items-center gap-8 px-4 pt-8 pb-10">
      <PracticeSteps current={current} />
      <div className={`flex w-full flex-col gap-6 ${width}`}>
        <div className="flex flex-col gap-2">
          <span className={`h-[42px] w-[340px] max-w-full rounded-[10px] ${bone}`} />
          <span className={`h-[26px] w-[220px] max-w-full rounded-[10px] ${bone}`} />
        </div>
        {children}
      </div>
    </div>
  );
}
