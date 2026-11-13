import Link from "next/link";
import type { ReactNode } from "react";

import { Spinner } from "@/components/spinner";

// 기준: Figma [초안] G02 Bottom Bar(484:2547: 높이 88 · 위 1px line · 좌우 40 · [뒤로] surface 둥글기 12 여백 22×12 16 Bold
// · [그룹 만들기] brand-strong 폭 280) · G03 Bottom Bar([취소] · [참가하기]) · G01 Bottom Bar(480:2414 [나가기] · [준비 완료],
// 483:2252 방장 · 모두 준비: [준비 취소] 흰 바탕 · 1px line 테두리 · [면접 시작] brand-strong)

const BUTTON =
  "flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl px-[22px] py-3 text-base leading-normal font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed";
const SURFACE = `${BUTTON} bg-surface text-text-1 disabled:opacity-60`;
const OUTLINE = `${BUTTON} border border-line bg-bg-sub text-text-1 disabled:opacity-60`;

export function GroupActionBar({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="sticky bottom-0 z-10 flex h-[88px] shrink-0 items-center justify-between gap-3 border-t border-line bg-bg px-4 sm:px-10">
      {children}
    </div>
  );
}

/** 왼쪽 이동 링크(G02 [뒤로] · G03 [취소]) */
export function GroupBackLink({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Link href={href} className={SURFACE}>
      {children}
    </Link>
  );
}

/** 보조 버튼: surface(G01 [나가기]) · outline(G01 방장 [준비 취소]) */
export function GroupSecondaryButton({
  children,
  onClick,
  pending = false,
  tone = "surface",
}: Readonly<{
  children: ReactNode;
  onClick: () => void;
  pending?: boolean;
  tone?: "surface" | "outline";
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-busy={pending || undefined}
      className={tone === "outline" ? OUTLINE : SURFACE}
    >
      {pending && <Spinner size={18} className="bg-text-1" />}
      {children}
    </button>
  );
}

/** 주 버튼(brand-strong · 폭 280). onClick을 주지 않으면 폼 제출이다 */
export function GroupPrimaryButton({
  children,
  disabled = false,
  pending = false,
  onClick,
}: Readonly<{ children: ReactNode; disabled?: boolean; pending?: boolean; onClick?: () => void }>) {
  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`${BUTTON} w-full max-w-[280px] bg-brand-strong text-white disabled:bg-surface disabled:text-text-3 sm:w-[280px]`}
    >
      {pending && <Spinner size={18} className="bg-white" />}
      {children}
    </button>
  );
}
