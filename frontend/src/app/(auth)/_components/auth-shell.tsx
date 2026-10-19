import Image from "next/image";
import type { ReactNode } from "react";

import { Logo } from "@/layouts/header";

// Figma S01 · S01-1 공통 틀: 왼쪽 브랜드 패널(640) + 오른쪽 폼(400, 가운데).
// 좁은 화면에서는 브랜드 패널을 숨기고 로고만 폼 위에 둔다.
export function AuthShell({
  message,
  card,
  children,
}: {
  /** 패널의 큰 문구 두 줄 */
  message: readonly [string, string];
  /** 패널의 스트릭 카드 */
  card: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh bg-bg">
      <aside className="relative hidden w-[640px] shrink-0 flex-col justify-between overflow-hidden bg-panel p-16 lg:flex">
        <Image
          src="/auth/panel-glow.svg"
          alt=""
          width={760}
          height={760}
          aria-hidden
          className="pointer-events-none absolute top-[420px] left-[-220px] max-w-none"
        />
        <div className="relative">
          <Logo />
        </div>
        <div className="relative flex flex-col gap-8">
          <p className="text-[44px] leading-[1.3] font-extrabold tracking-[-1.4px] text-text-1">
            {message[0]}
            <br />
            {message[1]}
          </p>
          {card}
        </div>
        <p className="relative text-sm leading-normal font-semibold text-text-3">
          Jev 기반 3D 면접관 · 면접 연습
        </p>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="mb-10 self-start lg:hidden">
          <Logo />
        </div>
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}

/** 패널 카드 공통 틀: 불꽃 아이콘 + 두 줄 문구 + 아래 내용 */
export function PanelCard({
  caption,
  title,
  children,
  gap = "gap-5",
}: {
  caption: string;
  title: string;
  children: ReactNode;
  gap?: string;
}) {
  return (
    <div
      className={`flex w-[400px] flex-col rounded-3xl bg-bg-sub p-6 drop-shadow-[0_8px_12px_rgba(255,122,38,0.1)] ${gap}`}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft dark:bg-brand-soft/8">
          <Image src="/auth/icon-flame-card.svg" alt="" width={24} height={24} />
        </span>
        <span className="flex flex-col leading-normal whitespace-nowrap">
          <span className="text-[13px] font-semibold text-text-3">{caption}</span>
          <span className="text-xl font-extrabold text-text-1">{title}</span>
        </span>
      </div>
      {children}
    </div>
  );
}
