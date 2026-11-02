import { Header, MobileThemeRow } from "@/layouts/header";

// 약관 · 처리방침 화면의 레이아웃. 로그인 여부와 상관없이 열리므로 로그인 · 메뉴 버튼 없이 로고(첫 화면으로)와 다크 모드 토글만 둔다.
// 기준: 공통 헤더(Header) · 사용자 결정(2026-10-30: 약관 화면은 Figma에 없어 알아서)
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Header menu={<MobileThemeRow />} />
      <div className="flex flex-1 flex-col">{children}</div>
    </>
  );
}
