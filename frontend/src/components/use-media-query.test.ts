import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMediaQuery } from "./use-media-query";

// 기준: React useSyncExternalStore(브라우저 값 구독) · MDN window.matchMedia(change 이벤트)
// S07-1은 넓은 화면(lg)에서만 질문 목록을 영상 옆 높이에 맞춘다. 화면 폭이 바뀌면 다시 그려야 한다.

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 맞는지 테스트가 정하고, 바뀌면 change를 알리는 matchMedia */
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
    set(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener());
    },
    listeners,
  };
}

describe("useMediaQuery", () => {
  it("지금 맞는지 돌려주고, 화면이 바뀌면(change) 다시 그린다", () => {
    const media = fakeMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(result.current).toBe(false);

    act(() => media.set(true));
    expect(result.current).toBe(true);

    act(() => media.set(false));
    expect(result.current).toBe(false);
  });

  it("화면을 떠나면 구독을 푼다", () => {
    const media = fakeMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(media.listeners.size).toBeGreaterThan(0);

    unmount();

    expect(media.listeners.size).toBe(0);
  });
});
