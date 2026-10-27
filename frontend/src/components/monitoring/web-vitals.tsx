"use client";

import { useReportWebVitals } from "next/web-vitals";

const timedMetrics = new Set(["TTFB", "FCP", "LCP", "INP"]);

function reportVital(metric: { name: string; value: number }) {
  if (process.env.NEXT_PUBLIC_A301_DEV_MONITORING !== "1") return;
  if (!timedMetrics.has(metric.name)) return;

  try {
    navigator.sendBeacon(
      "/api/monitoring/event",
      new Blob([JSON.stringify({ type: "vital", metric: metric.name, value: metric.value })], {
        type: "application/json",
      }),
    );
  } catch {
    // 계측 실패가 사용자 화면에 영향을 주지 않게 한다.
  }
}

export function WebVitals() {
  useReportWebVitals(reportVital);
  return null;
}
