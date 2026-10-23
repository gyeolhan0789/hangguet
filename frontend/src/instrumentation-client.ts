import { reportBrowserError } from "@/lib/monitoring/browser-events";

// 개발 서버 전용. 오류 내용·URL·사용자 식별자는 보내지 않고 유형만 집계한다.
if (process.env.NEXT_PUBLIC_A301_DEV_MONITORING === "1") {
  window.addEventListener("error", () => reportBrowserError("error"));
  window.addEventListener("unhandledrejection", () => reportBrowserError("unhandledrejection"));
}
