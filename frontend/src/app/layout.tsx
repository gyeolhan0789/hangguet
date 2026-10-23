import type { Metadata } from "next";

import { WebVitals } from "@/components/monitoring/web-vitals";
import { THEME_SCRIPT } from "@/lib/theme";

import { pretendard } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "한끗",
  description: "AI 기반 실전 모의면접 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="light" className={pretendard.variable} suppressHydrationWarning>
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
