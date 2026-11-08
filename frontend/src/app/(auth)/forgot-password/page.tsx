import type { Metadata } from "next";

import { ForgotPasswordView } from "./_components/forgot-password-view";

export const metadata: Metadata = { title: "비밀번호 찾기 · 한끗" };

// 비밀번호 찾기(1.8). S01 로그인 [비밀번호를 잊으셨나요?]로 들어온다. 화면은 S01-1 회원가입과 같은 틀(사용자 결정 2026-11-08)
export default function ForgotPasswordPage() {
  return <ForgotPasswordView />;
}
