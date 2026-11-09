"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ROUTES } from "@/lib/routes";

import { AuthShell } from "../../_components/auth-shell";
import { SignupForm } from "./signup-form";
import { StartCard } from "./start-card";

// S01-1 회원가입. 가입이 끝나면 왼쪽 '오늘' 링이 채워진 뒤 홈(S02-D 첫 방문)으로 넘어간다.
// 한 번 본 화면은 입력값 · 가입 완료 상태를 살려 다시 보여 주므로(cacheComponents · Activity), 로그아웃한 뒤 다시 와도 남지 않게
// 새로 들어올 때마다(push · replace) 새로 그리고, 뒤로 · 앞으로 가기로 돌아오면 그대로 둔다(Next useRouter().bfcacheId — 지원서 쓰기와 같은 방식).
export function SignupView() {
  const { bfcacheId } = useRouter();
  return <Signup key={bfcacheId} />;
}

function Signup() {
  const router = useRouter();
  const [completed, setCompleted] = useState(false);

  return (
    <AuthShell
      message={["오늘부터 1일째,", "같이 시작해요"]}
      card={<StartCard completed={completed} onFilled={() => router.replace(ROUTES.home)} />}
    >
      <SignupForm onComplete={() => setCompleted(true)} />
    </AuthShell>
  );
}
