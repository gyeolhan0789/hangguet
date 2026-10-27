import type { Metadata } from "next";

import { SignupView } from "./_components/signup-view";

export const metadata: Metadata = { title: "회원가입 · 한끗" };

// S01-1 회원가입
export default function SignupPage() {
  return <SignupView />;
}
