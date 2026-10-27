"use client";

import Link from "next/link";
import { useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { Toast } from "@/components/toast";
import { logout } from "@/lib/auth/actions";
import { ROUTES } from "@/lib/routes";
import type { MeResponse } from "@/types/api";

import { NicknameRow } from "./nickname-row";
import { PasswordRow } from "./password-row";
import { ProfilePhotoRow } from "./profile-photo-row";
import { ReminderCard } from "./reminder-card";
import { Card, Divider, pressableRow, RowArrow, rowTitle, Section } from "./settings-ui";
import { WithdrawModal } from "./withdraw-modal";

// 기준: Figma S09-1 설정(18:3157: 본문 위 40 · 가운데 720 · 간격 28 — '‹ 마이페이지'(15 SemiBold text-3) · '설정' 32 ExtraBold
// → 계정(프로필 사진 · 닉네임 · 이메일 '변경 불가' · 비밀번호 변경) → 알림(연습 알림 메일 · 추가 예정) → 기타(로그아웃) → '회원 탈퇴' 13 Medium text-3)
// · Swagger 2.1 내 정보(MeResponse) · 1.5 로그아웃 · 기획 메모 S09-1(18:1251) · 기획 메모 C01(18:1202: 로그아웃 시 확인 없이 S00 랜딩)

export function SettingsView({ me }: { me: MeResponse }) {
  const [withdrawing, setWithdrawing] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[752px] flex-col items-start gap-7 px-4 pt-10 pb-16">
      <div className="flex flex-col gap-2">
        <Link
          href={ROUTES.mypage}
          className="flex items-center gap-1 rounded-md text-[15px] leading-normal font-semibold tracking-[-0.2px] text-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <MaskIcon src="/mypage/icon-chevron-left.svg" size={18} className="bg-text-3" />
          마이페이지
        </Link>
        <h1 className="text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
          설정
        </h1>
      </div>

      <Section title="계정">
        <Card>
          <ProfilePhotoRow imageUrl={me.profileImageUrl} />
          <Divider />
          <NicknameRow nickname={me.nickname} />
          <Divider />
          <div className="flex items-center gap-2.5 py-[18px]">
            <span className={rowTitle}>이메일</span>
            <span className="flex-1" />
            <span className="truncate text-[15px] leading-normal font-medium tracking-[-0.2px] text-text-3">
              {me.email}
            </span>
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface px-2.5 py-1">
              <MaskIcon src="/mypage/icon-lock-xs.svg" size={12} className="bg-text-3" />
              <span className="text-xs leading-normal font-bold tracking-[-0.2px] text-text-3">
                변경 불가
              </span>
            </span>
          </div>
          <Divider />
          <PasswordRow />
        </Card>
      </Section>

      <Section title="알림">
        <ReminderCard />
      </Section>

      <Section title="기타">
        <Card>
          {/* 로그아웃: 확인 없이 랜딩(S00)으로 (C01과 같은 서버 액션) */}
          <form action={logout}>
            <button type="submit" className={pressableRow}>
              <MaskIcon src="/icons/log-out.svg" size={18} className="bg-text-2" />
              <span className={rowTitle}>로그아웃</span>
              <span className="flex-1" />
              <RowArrow />
            </button>
          </form>
        </Card>
      </Section>

      <button
        type="button"
        onClick={() => setWithdrawing(true)}
        className="cursor-pointer rounded-md text-[13px] leading-normal font-medium tracking-[-0.2px] text-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        회원 탈퇴
      </button>

      <WithdrawModal open={withdrawing} onClose={() => setWithdrawing(false)} />
      <Toast />
    </div>
  );
}
