import type { Metadata } from "next";

import { WebVitals } from "@/components/monitoring/web-vitals";
import { THEME_SCRIPT } from "@/lib/theme";

// Pretendard 1.3.9 가변 다이나믹 서브셋(SIL OFL 1.1, fonts/pretendard/PRETENDARD-LICENSE.txt). CDN 없이 직접 서빙한다.
// 글자를 92조각으로 나눈 공식 배포본(dist/web/variable)이라, 브라우저가 화면에 쓰인 글자가 든 조각만 받는다(unicode-range).
// next/font/local은 unicode-range로 나눈 파일을 다루지 못해 @font-face CSS를 그대로 불러온다.
import "./fonts/pretendard/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "한끗",
  description: "AI 기반 실전 모의면접 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="light" suppressHydrationWarning>
      <head>
        {/* 저장된 테마를 첫 페인트 전에 적용해 깜빡임을 막는다. */}
        <script
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
      </head>
      <body>
        <WebVitals />
        {children}
      </body>
    </html>
  );
}
