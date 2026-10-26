import Link from "next/link";

import { inquiryButtonClass } from "@/components/inquiry/inquiry-button-class";
import { Header, MobileMenuLink, MobileThemeRow } from "@/layouts/header";
import { ROUTES } from "@/lib/routes";

// 비회원 문의 화면(I04 · I01-B · I01-1)의 레이아웃. 기준: Figma I01-B · I04 헤더(로그인 전: 로고 · [로그인](작은 보조 버튼 84) · 다크 모드 토글)
// 로그인한 사람은 proxy가 이 화면에 들이지 않는다(GUEST_ONLY_PATHS).
export default function GuestInquiryLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Header
        menu={
          <>
            <MobileMenuLink href={ROUTES.login}>로그인</MobileMenuLink>
            <MobileThemeRow />
          </>
        }
      >
        <Link href={ROUTES.login} className={`w-[84px] ${inquiryButtonClass("secondary", "sm")}`}>
          로그인
        </Link>
      </Header>
      <div className="flex flex-1 flex-col">{children}</div>
    </>
  );
}
