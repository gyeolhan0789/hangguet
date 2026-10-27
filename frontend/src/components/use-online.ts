import { useSyncExternalStore } from "react";

// 브라우저가 온라인인지. 기준: 사용자 결정(2026-10-22: 인터넷이 끊기면 다시 조회하지 않고 기다렸다가, 다시 연결되면 이어서 조회한다)
// · React useSyncExternalStore(브라우저 값 구독) · MDN navigator.onLine · online/offline 이벤트

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** 지금 온라인이면 true. 서버에서 그릴 때는 온라인으로 본다 */
export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
