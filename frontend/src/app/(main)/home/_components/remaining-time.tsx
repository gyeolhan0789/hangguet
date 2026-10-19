"use client";

import { useSyncExternalStore } from "react";

import { untilMidnightKst } from "@/lib/date";

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 1000);
  return () => clearInterval(timer);
}

/** 한국 시간 자정까지 남은 시간. 서버 렌더링 때는 비워 두고 브라우저에서 1초마다 갱신한다. */
export function RemainingTime() {
  const time = useSyncExternalStore(
    subscribe,
    () => untilMidnightKst(),
    () => "--:--:--",
  );
  return <span className="tabular-nums">{time}</span>;
}
