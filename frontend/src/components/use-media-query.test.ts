// 기준: React useSyncExternalStore(브라우저 값 구독) · MDN window.matchMedia(change 이벤트)
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMediaQuery } from "./use-media-query";

// 경계 mock: 브라우저 matchMedia(맞는지 테스트가 정하고, 바뀌면 change를 알린다)
function fakeMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (media: string) => ({
    get matches() {
      return matches;
    },
    media,
    addEventListener: (_: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_: "change", listener: () => void) => listeners.delete(listener),
  }));
  return {
    change(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("useMediaQuery · 미디어 쿼리 일치", () => {
  describe("상태 변화", () => {
    it("화면이 바뀌어(change) 맞는지가 달라지면 새 값을 돌려준다", () => {
      const media = fakeMatchMedia(false);
      const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
      expect(result.current).toBe(false);

      act(() => media.change(true));

      expect(result.current).toBe(true);
    });
  });
});
