import Image from "next/image";
import Link from "next/link";

import { MaskIcon } from "@/components/mask-icon";
import type { MeResponse } from "@/types/api";
import { ROUTES } from "@/lib/routes";

import { ProfileMenu } from "./profile-menu";

/** 헤더 스트릭 알약. 0일(끊김·첫 방문)이면 회색 (Figma S02-C · S02-D 헤더) */
function StreakPill({ days }: { days: number }) {
  const broken = days === 0;
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 ${
        broken ? "bg-surface" : "bg-gold-soft dark:bg-gold-soft/9"
      }`}
    >
      {broken ? (
        <MaskIcon src="/icons/streak-flame.svg" size={18} className="bg-text-3" />
      ) : (
        <Image src="/icons/streak-flame.svg" alt="" width={18} height={18} />
      )}
      <span
        className={`text-[15px] leading-normal font-extrabold ${broken ? "text-text-3" : "text-gold-ink"}`}
      >
        {days}일<span className="sr-only"> 연속 연습 중</span>
      </span>
    </span>
  );
}

// Figma C/App Header 오른쪽: 홈 · 연습 기록 · 스트릭 · 프로필 (간격 28).
// 헤더가 붙이는 다크 모드 토글과의 간격도 28이 되도록 오른쪽에 12를 더한다(헤더 기본 간격 16).
export function AppNav({ user }: { user: MeResponse }) {
  return (
    <nav aria-label="주요 메뉴" className="flex items-center gap-4 pr-3 sm:gap-7">
      <Link
        href={ROUTES.home}
        className="hidden text-base leading-normal font-bold text-text-1 group-data-[overlay=true]/header:text-white sm:block"
      >
        홈
      </Link>
      <Link
        href={ROUTES.records}
        className="hidden text-base leading-normal font-semibold text-text-3 group-data-[overlay=true]/header:text-white/70 sm:block"
      >
        연습 기록
      </Link>
      <StreakPill days={user.currentStreak} />
      <ProfileMenu user={user} />
    </nav>
  );
}

/** 내 정보를 불러오는 동안 (Figma S02-1 Home Skeleton 헤더) */
export function AppNavSkeleton() {
  return (
    <div aria-hidden data-testid="app-nav-skeleton" className="flex items-center gap-6 pr-2">
      <span className="hidden h-5 w-8 rounded-[10px] bg-surface sm:block" />
      <span className="hidden h-5 w-16 rounded-[10px] bg-surface sm:block" />
      <span className="h-[34px] w-16 rounded-full bg-surface" />
      <span className="size-9 rounded-full bg-surface" />
    </div>
  );
}
