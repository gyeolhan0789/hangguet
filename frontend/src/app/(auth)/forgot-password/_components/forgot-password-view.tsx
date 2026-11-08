"use client";

import { useRouter } from "next/navigation";

import { AuthShell } from "../../_components/auth-shell";
import { StreakWaveCard } from "../../login/_components/streak-wave-card";
import { ForgotPasswordForm } from "./forgot-password-form";

// 한 번 본 화면은 입력값 · 보낸 상태를 살려 다시 보여 주므로(cacheComponents · Activity), 새로 들어올 때마다(push · replace)
// 새로 그리고, 뒤로 · 앞으로 가기로 돌아오면 그대로 둔다(회원가입과 같은 방식).
export function ForgotPasswordView() {
  const { bfcacheId } = useRouter();
  return (
    <AuthShell message={["비밀번호를 잊어도", "스트릭은 그대로예요"]} card={<StreakWaveCard />}>
      <ForgotPasswordForm key={bfcacheId} />
    </AuthShell>
  );
}
