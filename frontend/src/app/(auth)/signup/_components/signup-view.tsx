"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ROUTES } from "@/lib/routes";

import { AuthShell } from "../../_components/auth-shell";
import { SignupForm } from "./signup-form";
import { StartCard } from "./start-card";

// S01-1 회원가입. 가입이 끝나면 왼쪽 '오늘' 링이 채워진 뒤 홈(S02-D 첫 방문)으로 넘어간다.
export function SignupView() {
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
