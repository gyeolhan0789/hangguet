"use client";

import { useEffect } from "react";

import { reportBrowserError } from "@/lib/monitoring/browser-events";

import "./fonts/pretendard/pretendardvariable-dynamic-subset.css";
import "./globals.css";

/** 루트 레이아웃까지 실패했을 때. 레이아웃을 대신하므로 html · body와 전역 스타일을 직접 불러온다. */
export default function GlobalError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  useEffect(() => {
    console.error(error);
    reportBrowserError("boundary");
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
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
      </body>
    </html>
  );
}
