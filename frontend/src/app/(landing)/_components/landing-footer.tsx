import Link from "next/link";

import { Logo } from "@/layouts/header";
import { ROUTES } from "@/lib/routes";

// 기준: Figma S00 푸터(로고 · '이용약관 · 개인정보처리방침 · © 2026 A301' 한 가지 글자 모양) · 「개인정보 보호법」 제30조(처리방침 공개)
const linkClass =
  "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function LandingFooter() {
  return (
    <footer className="flex flex-col items-start gap-4 bg-bg-sub px-6 py-10 sm:flex-row sm:items-center sm:justify-between lg:px-40">
      <Logo />
      <p className="text-sm leading-normal font-medium text-text-3">
        <Link href={ROUTES.terms} className={linkClass}>
          이용약관
        </Link>
        {" · "}
        <Link href={ROUTES.privacy} className={linkClass}>
          개인정보처리방침
        </Link>
        {" · © 2026 A301"}
      </p>
    </footer>
  );
}
