import { useSyncExternalStore } from "react";

// 화면 폭 같은 미디어 쿼리가 지금 맞는지. 기준: React useSyncExternalStore(브라우저 값 구독) · MDN window.matchMedia

/** query가 지금 맞으면 true. 서버에서 그릴 때는 false로 본다 */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
