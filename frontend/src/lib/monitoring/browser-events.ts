/** 개발 서버에서만 브라우저 오류 유형을 보낸다. 오류 내용·URL·사용자 정보는 보내지 않는다. */
export function reportBrowserError(kind: "error" | "unhandledrejection" | "boundary") {
  if (process.env.NEXT_PUBLIC_A301_DEV_MONITORING !== "1") return;

  try {
    navigator.sendBeacon(
      "/api/monitoring/event",
      new Blob([JSON.stringify({ type: "error", kind })], { type: "application/json" }),
    );
  } catch {
    // 계측 실패가 사용자 화면에 영향을 주지 않게 한다.
  }
}
