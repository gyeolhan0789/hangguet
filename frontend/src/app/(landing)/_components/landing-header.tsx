import Link from "next/link";
import { Suspense } from "react";

import { AppNav, Header } from "@/layouts/header";
import { getMe } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

function GuestNav() {
  return (
    <>
      <a
        href="#features"
        className="hidden text-base font-semibold text-text-2 group-data-[overlay=true]/header:text-white/80 sm:block"
      >
        서비스 소개
      </a>
      <Link
        href={ROUTES.login}
        className="hidden h-10 items-center rounded-[10px] bg-surface px-[18px] text-[15px] font-bold text-text-1 group-data-[overlay=true]/header:bg-white/12 group-data-[overlay=true]/header:text-white sm:flex"
      >
        로그인
      </Link>
      <Link
        href={ROUTES.signup}
        className="flex h-10 items-center rounded-[10px] bg-brand-strong px-[18px] text-[15px] font-bold text-white"
      >
        시작하기
      </Link>
    </>
  );
}

/** 로그인했으면 앱 헤더 메뉴, 아니면 로그인·시작하기. 내 정보를 못 불러오면 로그인 전 메뉴를 보여 준다. */
async function LandingNav() {
  const me = await getMe().catch(() => null);
  return me ? <AppNav user={me} /> : <GuestNav />;
}

// Figma S00 Landing Nav: 히어로 위에서는 투명, 스크롤하면 배경이 생기고 메뉴가 계속 보인다.
// 로그인 여부는 요청마다 쿠키로 정하므로 그 부분만 <Suspense>로 감싼다(나머지는 정적).
export function LandingHeader() {
  return (
    <Header overlay>
      <Suspense>
        <LandingNav />
      </Suspense>
    </Header>
  );
}
