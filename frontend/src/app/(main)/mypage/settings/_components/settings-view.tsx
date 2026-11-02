"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { Toast } from "@/components/toast";
import { logout } from "@/lib/auth/actions";
import { dismissNotice } from "@/lib/auth/social-actions";
import { ROUTES } from "@/lib/routes";
import { useToastStore } from "@/stores/toast-store";
import type { MeResponse, PracticeAlarmResponse } from "@/types/api";

import { KakaoRow } from "./kakao-row";
import { NicknameRow } from "./nickname-row";
import { PasswordRow } from "./password-row";
import { ProfilePhotoRow } from "./profile-photo-row";
import { ReminderCard } from "./reminder-card";
import { Card, Divider, pressableRow, RowArrow, rowTitle, Section } from "./settings-ui";
import { WithdrawModal } from "./withdraw-modal";

// 기준: Figma S09-1 설정(18:3157: 본문 위 40 · 가운데 720 · 간격 28 — '‹ 마이페이지'(15 SemiBold text-3) · '설정' 32 ExtraBold
// → 계정(프로필 사진 · 닉네임 · 이메일 '변경 불가' · 비밀번호 변경 · 카카오) → 알림(카카오톡 연습 알림 · 2.8) → 기타(로그아웃) → '회원 탈퇴' 13 Medium text-3)
// · Swagger 2.1 내 정보(MeResponse) · 1.5 로그아웃 · 기획 메모 S09-1(18:1251) · 기획 메모 C01(18:1202: 로그아웃 시 확인 없이 S00 랜딩)
// · S09-1-B(436:2104: '비밀번호 변경' text-3 · 누를 수 없음) · 카카오 줄은 kakao-row.tsx(2.12 연결 · 2.13 해제)
// · 기획 메모 S09-1 · S09-1-B(소셜 회원은 비밀번호가 없어 2.3을 쓸 수 없음(409 PASSWORD_NOT_SET) · 2.7에 비밀번호를 보내지 않음
// · 알림 켜기 · 계정 연결 실패는 토스트)

export function SettingsView({
  me,
  alarm,
  notice,
  linked = false,
}: {
  me: MeResponse;
  /** 2.8 연습 알림 설정 */
  alarm: PracticeAlarmResponse;
  /** 카카오 알림 동의 · 계정 연결에서 실패하고 돌아왔을 때 한 번 보여 줄 문구(콜백이 쿠키로 넘긴다) */
  notice?: string;
  /** 카카오 계정을 연결하고 막 돌아왔다(완료 안내 모달) */
  linked?: boolean;
}) {
  const [withdrawing, setWithdrawing] = useState(false);
  const notify = useToastStore((state) => state.show);
  const social = me.socialProvider !== null;

  // 보여 준 문구는 지워서, 새로 고치면 다시 뜨지 않게 한다.
  useEffect(() => {
    if (!notice) return;
    notify({ text: notice });
    void dismissNotice();
  }, [notice, notify]);

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
          {social ? (
            <button
              type="button"
              disabled
              className="flex w-full items-center gap-2.5 py-[18px] text-left text-base leading-normal font-semibold tracking-[-0.2px] text-text-3"
            >
              비밀번호 변경
            </button>
          ) : (
            <PasswordRow />
          )}
          <Divider />
          <KakaoRow me={me} linked={linked} />
        </Card>
      </Section>

      <Section title="알림">
        <ReminderCard alarm={alarm} />
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

      <WithdrawModal open={withdrawing} social={social} onClose={() => setWithdrawing(false)} />
      <Toast />
    </div>
  );
}
