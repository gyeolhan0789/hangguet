"use client";

import { useEffect } from "react";

import { reportBrowserError } from "@/lib/monitoring/browser-events";

/**
 * 로그인 후 화면(홈 등)을 그리다 생긴 예상 밖 오류(API 500 등). 헤더는 그대로 두고 본문만 바꾼다.
 * Figma에 오류 화면이 없어 기존 색·글씨 토큰으로 최소한만 그린다.
 */
export default function MainError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportBrowserError("boundary");
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-2xl leading-normal font-extrabold text-text-1">
        화면을 불러오지 못했어요
      </h1>
      <p className="text-base leading-normal font-medium text-text-2">
        잠시 후 다시 시도해 주세요.
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-2 flex h-14 cursor-pointer items-center justify-center rounded-2xl bg-brand-strong px-8 text-[17px] leading-normal font-bold text-white"
      >
        다시 시도
      </button>
    </main>
  );
}
