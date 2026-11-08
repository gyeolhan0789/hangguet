import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "../_components/auth-shell";
import { StreakWaveCard } from "../login/_components/streak-wave-card";
import { PasswordResetView } from "./_components/password-reset-view";

// 주소의 token이 다른 사이트로 새지 않도록 이 화면에서 나가는 요청에는 Referer를 붙이지 않는다.
export const metadata: Metadata = { title: "비밀번호 재설정 · 한끗", referrer: "no-referrer" };

// 비밀번호 재설정(1.9). 재설정 메일의 링크(`/password-reset?token=…`, BE PASSWORD_RESET_URL)로 들어온다.
// 기준: Swagger 1.9 비밀번호 재설정 · PasswordResetConfirmRequest · 사용자 결정(2026-11-08: Figma 시안이 없어 회원가입과 같은 틀,
// 왼쪽 패널은 비밀번호 찾기와 같게)
async function ResetForm({ searchParams }: Pick<PageProps<"/password-reset">, "searchParams">) {
  const { token } = await searchParams;
  return <PasswordResetView token={typeof token === "string" ? token : ""} />;
}

// 틀은 주소를 읽는 동안에도 바로 뜨도록 Suspense 밖에 두고, token으로 갈리는 폼만 Suspense 안에서 그린다(로그인 화면과 같음).
export default function PasswordResetPage({ searchParams }: PageProps<"/password-reset">) {
  return (
    <AuthShell message={["비밀번호를 잊어도", "스트릭은 그대로예요"]} card={<StreakWaveCard />}>
      {/* 주소를 읽는 동안 보여 줄 화면은 Figma에 없다. */}
      <Suspense fallback={null}>
        <ResetForm searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
