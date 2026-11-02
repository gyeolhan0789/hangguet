"use client";

import { useEffect } from "react";

import { dismissNotice } from "@/lib/auth/social-actions";
import { useLoginNoticeStore } from "@/stores/login-notice-store";

// 카카오 로그인 · 가입 실패 문구를 S01 오류 문구 자리(LoginForm)로 넘기고 쿠키를 지운다. 그리는 것은 없다.
// 기준: 기획 메모 S01-3(423:2140: 오류는 모달을 닫고 S01 로그인 버튼 위 오류 문구 자리에)

export function LoginNotice({ text }: { text: string }) {
  const show = useLoginNoticeStore((state) => state.show);

  // 문구를 먼저 담고 쿠키를 지운다(지우면 화면이 다시 그려져 이 컴포넌트는 사라진다). 새로 고치면 다시 뜨지 않는다.
  useEffect(() => {
    show(text);
    void dismissNotice();
  }, [text, show]);

  return null;
}
