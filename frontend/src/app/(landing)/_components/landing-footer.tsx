import { Logo } from "@/layouts/header";

export function LandingFooter() {
  return (
    <footer className="flex flex-col items-start gap-4 bg-bg-sub px-6 py-10 sm:flex-row sm:items-center sm:justify-between lg:px-40">
      <Logo />
      <p className="text-sm leading-normal font-medium text-text-3">
        이용약관 · 개인정보처리방침 · © 2026 A301
      </p>
    </footer>
  );
}
