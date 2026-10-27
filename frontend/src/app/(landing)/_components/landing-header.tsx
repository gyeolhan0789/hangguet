import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { cache, Suspense } from "react";

import { AppMobileMenu, AppNav, Header, MobileMenuLink, MobileThemeRow } from "@/layouts/header";
import { getMe } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

// 기준: Figma S00 Landing Nav(로그인 전: [문의하기] · 서비스 소개 · [로그인] · [시작하기], 문의하기는 서비스 소개와 같은 모양) · 기획 메모 I04(→ I04)
function GuestNav() {
  return (
    <>
      <Link
        href={ROUTES.guestInquiry}
        className="hidden text-base font-semibold text-text-2 group-data-[overlay=true]/header:text-white/80 sm:block"
      >
        문의하기
      </Link>
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

// 데스크톱 메뉴와 모바일 햄버거 메뉴가 같은 요청 안에서 한 번만 부르도록 묶는다
const loadMe = cache(async () => {
  let me: Awaited<ReturnType<typeof getMe>> = null;
  try {
    me = await getMe();
  } catch (error) {
    // 쿠키를 읽어 요청마다 그려야 한다는 Next 신호(prerender 중단 등)는 Next가 처리하도록 다시 던진다.
    unstable_rethrow(error);
    // 내 정보가 실패해도 랜딩은 열려야 하므로 로그인 전 메뉴로 그린다. 원인은 서버 로그에 남긴다.
    console.error("랜딩 헤더: 내 정보(2.1)를 불러오지 못했어요.", error);
  }
  return me;
});

/** 모바일(sm 미만) 햄버거 메뉴: 로그인 전 메뉴(문의하기 · 서비스 소개 · 로그인 · 시작하기)와 다크 모드 */
function GuestMobileMenu() {
  return (
    <>
      <MobileMenuLink href={ROUTES.guestInquiry}>문의하기</MobileMenuLink>
      <MobileMenuLink href="#features">서비스 소개</MobileMenuLink>
      <MobileMenuLink href={ROUTES.login}>로그인</MobileMenuLink>
      <MobileMenuLink href={ROUTES.signup}>시작하기</MobileMenuLink>
      <MobileThemeRow />
    </>
  );
}

/** 로그인했으면 앱 헤더 메뉴, 아니면 로그인·시작하기. */
async function LandingNav() {
  const me = await loadMe();
  return me ? <AppNav user={me} /> : <GuestNav />;
}

async function LandingMobileMenu() {
  const me = await loadMe();
  return me ? <AppMobileMenu user={me} /> : <GuestMobileMenu />;
}

// Figma S00 Landing Nav: 히어로 위에서는 투명, 스크롤하면 배경이 생기고 메뉴가 계속 보인다.
// 로그인 여부는 요청마다 쿠키로 정하므로 그 부분만 <Suspense>로 감싼다(나머지는 정적).
export function LandingHeader() {
  return (
    <Header
      overlay
      menu={
        <Suspense fallback={<MobileThemeRow />}>
          <LandingMobileMenu />
        </Suspense>
      }
    >
      <Suspense>
        <LandingNav />
      </Suspense>
    </Header>
  );
}
