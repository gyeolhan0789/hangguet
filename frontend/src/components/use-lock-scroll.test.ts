import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useLockScroll } from "./use-lock-scroll";

// 기준: 햄버거 메뉴 · 공지 모달(C02)처럼 여러 곳이 겹쳐 잠가도, 마지막 하나가 풀릴 때만 원래 overflow로 되돌린다.

const overflow = () => document.documentElement.style.overflow;

afterEach(() => {
  document.documentElement.style.overflow = "";
});

describe("useLockScroll", () => {
  it("잠그면 hidden, 풀면 원래 값으로 되돌린다", () => {
    document.documentElement.style.overflow = "auto";
    const { rerender } = renderHook(({ locked }) => useLockScroll(locked), {
      initialProps: { locked: true },
    });
    expect(overflow()).toBe("hidden");

    rerender({ locked: false });
    expect(overflow()).toBe("auto");
  });

  it("두 곳이 잠그면 연 순서와 상관없이 마지막 하나가 풀릴 때만 되돌린다", () => {
    const first = renderHook(() => useLockScroll(true));
    const second = renderHook(() => useLockScroll(true));

    // 먼저 연 쪽이 먼저 풀려도 아직 잠겨 있다
    first.unmount();
    expect(overflow()).toBe("hidden");

    second.unmount();
    expect(overflow()).toBe("");
  });
});
