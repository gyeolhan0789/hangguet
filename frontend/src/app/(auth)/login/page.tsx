import type { Metadata } from "next";

import { AuthShell } from "../_components/auth-shell";
import { LoginForm } from "./_components/login-form";
import { StreakWaveCard } from "./_components/streak-wave-card";

export const metadata: Metadata = { title: "로그인 · 한끗" };

// S01 로그인
export default function LoginPage() {
  return (
    <AuthShell message={["오늘도 한 끗,", "더 나아지러 왔어요"]} card={<StreakWaveCard />}>
      <LoginForm />
    </AuthShell>
  );
}
