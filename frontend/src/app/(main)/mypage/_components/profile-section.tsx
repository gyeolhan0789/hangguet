import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { MaskIcon } from "@/components/mask-icon";
import { PROFILE_IMAGE_ANCHOR, ROUTES } from "@/lib/routes";
import { startedLabel } from "@/lib/user/calendar";
import type { MeResponse, StatsResponse } from "@/types/api";

// 기준: Figma S09 Profile(18:2867: 아바타 104 · ✎ 32(왼 72 · 위 72) · 닉네임 32 ExtraBold · '이메일 · 2026년 9월 시작' 15 Medium
// · 직무 칩(brand-soft · briefcase 12 · 12 Bold) · [⚙ 설정] 48) · Swagger 2.1 내 정보(MeResponse: nickname · email · createdAt
// · profileImageUrl) · 3.2 통계(latestJobTitle "백엔드 개발자" → 칩 "백엔드 개발자 준비 중") · 모션 메모 S09(18:3109: 프로필 사진 ✎ → S09-1 프로필 사진)

export function ProfileSection({ me, stats }: { me: MeResponse; stats: StatsResponse }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-5">
      <div className="flex min-w-0 items-center gap-5">
        <div className="relative shrink-0">
          <Avatar
            imageUrl={me.profileImageUrl}
            size={104}
            icon="/mypage/icon-user-round-xl.svg"
            iconSize={52}
          />
          <Link
            href={`${ROUTES.settings}#${PROFILE_IMAGE_ANCHOR}`}
            aria-label="프로필 사진 바꾸기"
            className="absolute top-[72px] left-[72px] flex size-8 items-center justify-center rounded-full border border-line bg-bg-sub focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <MaskIcon src="/mypage/icon-pencil.svg" size={14} className="bg-text-2" />
          </Link>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1.5 tracking-[-0.2px]">
          <h1 className="truncate text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
            {me.nickname}
          </h1>
          <p className="text-[15px] leading-normal font-medium break-keep text-text-3">
            {me.email} · {startedLabel(me.createdAt)}
          </p>
          <span className="flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 dark:bg-brand-soft/8">
            <MaskIcon src="/mypage/icon-briefcase.svg" size={12} className="bg-brand-ink" />
            <span className="text-xs leading-normal font-bold text-brand-ink">
              {stats.latestJobTitle} 준비 중
            </span>
          </span>
        </div>
      </div>
      <Link
        href={ROUTES.settings}
        className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-surface px-[18px] text-[15px] leading-normal font-bold tracking-[-0.2px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <MaskIcon src="/mypage/icon-settings.svg" size={18} className="bg-text-1" />
        설정
      </Link>
    </div>
  );
}
