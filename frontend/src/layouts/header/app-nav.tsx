import Image from "next/image";
import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { MaskIcon } from "@/components/mask-icon";
import type { MeResponse, NoticeItem } from "@/types/api";
import { ROUTES } from "@/lib/routes";

import {
  MobileLogout,
  MobileMenuDivider,
  MobileMenuLink,
  MobileNotices,
  MobileThemeRow,
} from "./mobile-menu";
import { NoticeBell } from "./notice-bell";
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

// Figma C/App Header 오른쪽: 홈 · 연습 기록 · 스트릭 · 프로필 · 공지 (간격 28). 공지 버튼은 다크 모드 토글 바로 왼쪽(기획 메모 C01).
// 헤더가 붙이는 다크 모드 토글과의 간격도 28이 되도록 오른쪽에 12를 더한다(헤더 기본 간격 16).
// 공지는 종(C03)에서 골라 C02로 연다(사용자 결정 2026-10-23: 앱에 들어오면 차례대로 띄우기 폐기).
// 랜딩(S00)처럼 공지를 넘기지 않으면 공지 버튼이 없다.
export function AppNav({ user, notices }: { user: MeResponse; notices?: NoticeItem[] }) {
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
      {notices && <NoticeBell notices={notices} />}
    </nav>
  );
}

/**
 * 모바일(sm 미만) 햄버거 메뉴: 데스크톱 헤더 메뉴(홈 · 연습 기록 · 스트릭 · 공지 · 다크 모드)와 C01 프로필 메뉴(마이페이지 · 문의하기 · 로그아웃)를
 * 한곳에 모은다. 맨 위는 C01 드롭다운 머리(아바타 40 · 닉네임 15 ExtraBold · 이메일 13 Medium text-3)에 스트릭 알약을 붙인다.
 * 랜딩(S00)처럼 공지를 넘기지 않으면 공지 줄이 없다.
 */
export function AppMobileMenu({ user, notices }: { user: MeResponse; notices?: NoticeItem[] }) {
  return (
    <>
      <div className="flex items-center gap-3 p-3">
        <Avatar
          imageUrl={user.profileImageUrl}
          size={40}
          icon="/icons/user-round.svg"
          iconSize={20}
        />
        <div className="flex min-w-0 flex-1 flex-col leading-normal">
          <span className="truncate text-[15px] font-extrabold text-text-1">{user.nickname}</span>
          <span className="truncate text-[13px] font-medium text-text-3">{user.email}</span>
        </div>
        <StreakPill days={user.currentStreak} />
      </div>
      <MobileMenuDivider />
      <MobileMenuLink href={ROUTES.home}>홈</MobileMenuLink>
      <MobileMenuLink href={ROUTES.records}>연습 기록</MobileMenuLink>
      {notices && <MobileNotices notices={notices} />}
      <MobileMenuDivider />
      <MobileMenuLink href={ROUTES.mypage} icon="/icons/user-round.svg" chevron>
        마이페이지
      </MobileMenuLink>
      <MobileMenuLink href={ROUTES.inquiries} icon="/icons/message-circle.svg">
        문의하기
      </MobileMenuLink>
      <MobileMenuDivider />
      <MobileThemeRow />
      <MobileMenuDivider />
      <MobileLogout />
    </>
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
      <span className="size-9 rounded-full bg-surface" />
    </div>
  );
}
