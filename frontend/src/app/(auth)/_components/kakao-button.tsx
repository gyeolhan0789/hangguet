"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { startKakaoLogin } from "@/lib/auth/social-actions";

// 기준: Figma S01 Button 카카오 로그인 · S01-1 Button 카카오로 시작하기(434:2095 · 434:2099 · Dark 447:2128 · 447:2132:
// [로그인] · [가입하고 시작하기] 바로 아래, 같은 높이 · 둥글기 14 · 노랑 #FEE500 · 검정 말풍선 20 · 17 Bold 검정 85%) · 카카오 로그인 디자인 가이드(컨테이너 #FEE500
// · 심볼 #000000 · 레이블 #000000 85%) · 기획 메모 S01-3(423:2140: [카카오 로그인] → 카카오 동의 화면 → 콜백)

export function KakaoButton({
  children,
  height = "h-14",
}: {
  /** '카카오 로그인'(S01) · '카카오로 시작하기'(S01-1) */
  children: string;
  /** 바로 위 제출 버튼과 같은 높이(Tailwind h-*) */
  height?: string;
}) {
  // 카카오 화면으로 간 뒤 뒤로 가기로 돌아오면 브라우저가 페이지를 그대로 되살려(bfcache) 버튼이 진행 중인 채 굳는다.
  // 그때는 폼을 새로 만들어 다시 누를 수 있게 한다.
  const [restored, setRestored] = useState(0);
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRestored((count) => count + 1);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return (
    <form key={restored} action={startKakaoLogin}>
      <Submit height={height}>{children}</Submit>
    </form>
  );
}

function Submit({ children, height }: { children: string; height: string }) {
  // 카카오 화면으로 넘어가는 동안 두 번 누르지 않게 막는다
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-[14px] bg-[#FEE500] px-6 text-[17px] leading-normal font-bold tracking-[-0.2px] text-black/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${height}`}
    >
      <Image src="/auth/icon-kakao.svg" alt="" width={20} height={20} />
      {children}
    </button>
  );
}
