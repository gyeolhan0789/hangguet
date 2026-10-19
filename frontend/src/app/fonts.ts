import localFont from "next/font/local";

// Pretendard 1.3.9 가변 폰트(SIL OFL 1.1, fonts/PRETENDARD-LICENSE.txt). CDN 없이 직접 서빙한다.
export const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  weight: "45 920",
  display: "swap",
  variable: "--font-pretendard",
});
