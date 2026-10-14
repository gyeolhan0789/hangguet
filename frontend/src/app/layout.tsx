import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "한끗",
  description: "AI 기반 실전 모의면접 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
