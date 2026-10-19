import Link from "next/link";

import { Header } from "@/layouts/header";

// Figma S00 Landing Nav: 히어로 위에서는 투명, 스크롤하면 배경이 생기고 [시작하기]가 계속 보인다.
export function LandingHeader() {
  return (
    <Header overlay>
      <a
        href="#features"
        className="hidden text-base font-semibold text-text-2 group-data-[overlay=true]/header:text-white/80 sm:block"
      >
        서비스 소개
      </a>
      <Link
        href="/login"
        className="hidden h-10 items-center rounded-[10px] bg-surface px-[18px] text-[15px] font-bold text-text-1 group-data-[overlay=true]/header:bg-white/12 group-data-[overlay=true]/header:text-white sm:flex"
      >
        로그인
      </Link>
      <Link
        href="/login"
        className="flex h-10 items-center rounded-[10px] bg-brand-strong px-[18px] text-[15px] font-bold text-white"
      >
        시작하기
      </Link>
    </Header>
  );
}
