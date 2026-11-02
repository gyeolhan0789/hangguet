import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { NOTICE_COOKIE, readNotice, SOCIAL_SIGNUP_COOKIE } from "@/lib/auth/kakao";

import { AuthShell } from "../_components/auth-shell";
import { LoginForm } from "./_components/login-form";
import { LoginNotice } from "./_components/login-notice";
import { SocialSignupModal } from "./_components/social-signup-modal";
import { StreakWaveCard } from "./_components/streak-wave-card";

export const metadata: Metadata = { title: "로그인 · 한끗" };

// 카카오에서 돌아온 상태는 쿠키로 읽는다(lib/auth/kakao.ts). 기준: 기획 메모 S01-3(423:2140)
// 폼은 쿠키를 읽는 동안에도 바로 뜨도록 Suspense 밖에 두고, 쿠키로 정해지는 부분만 Suspense 안에서 그린다.

/** 실패하고 돌아왔을 때 한 번 보여 줄 문구 */
async function KakaoNotice() {
  const text = readNotice((await cookies()).get(NOTICE_COOKIE)?.value, "login");
  return text ? <LoginNotice text={text} /> : null;
}

/** 처음 온 사람(1.6 signupRequired)이면 약관 동의 모달(S01-3) */
async function KakaoSignup() {
  return (await cookies()).has(SOCIAL_SIGNUP_COOKIE) ? <SocialSignupModal /> : null;
}

// S01 로그인
export default function LoginPage() {
  return (
    <AuthShell message={["오늘도 한 끗,", "더 나아지러 왔어요"]} card={<StreakWaveCard />}>
      <LoginForm
        notice={
          <Suspense fallback={null}>
            <KakaoNotice />
          </Suspense>
        }
      />
      <Suspense fallback={null}>
        <KakaoSignup />
      </Suspense>
    </AuthShell>
  );
}
