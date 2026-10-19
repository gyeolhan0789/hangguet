import Image from "next/image";
import Link from "next/link";

import type { UserResponse } from "@/lib/api/types";
import { ROUTES } from "@/lib/routes";

import { ProfileMenu } from "./profile-menu";

// Figma C/App Header 오른쪽: 홈 · 연습 기록 · 스트릭 · 프로필 (간격 28).
// 헤더가 붙이는 다크 모드 토글과의 간격도 28이 되도록 오른쪽에 12를 더한다(헤더 기본 간격 16).
export function AppNav({ user }: { user: UserResponse }) {
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
      <span className="flex items-center gap-1.5 rounded-full bg-gold-soft px-3.5 py-2 dark:bg-gold-soft/9">
        <Image src="/icons/streak-flame.svg" alt="" width={18} height={18} />
        <span className="text-[15px] leading-normal font-extrabold text-gold-ink">
          {user.currentStreak}일<span className="sr-only"> 연속 연습 중</span>
        </span>
      </span>
      <ProfileMenu user={user} />
    </nav>
  );
}
