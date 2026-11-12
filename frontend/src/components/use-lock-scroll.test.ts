// 기준: Figma C01 햄버거 메뉴 · C02 공지 모달 · S05-E(18:4013) 권한 안내 모달(떠 있는 동안 뒤 페이지 고정)
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 모듈 수준 잠금 수(locks · previous)가 테스트 사이에 남지 않게 테스트마다 새로 불러온다
let useLockScroll: typeof import("./use-lock-scroll").useLockScroll;

beforeEach(async () => {
  vi.resetModules();
  ({ useLockScroll } = await import("./use-lock-scroll"));
});

afterEach(() => {
  document.documentElement.style.overflow = "";
});

const overflow = () => document.documentElement.style.overflow;

describe("useLockScroll · 뒤 페이지 스크롤 잠금", () => {
  describe("정상 처리", () => {
    it("잠그면 뒤 페이지 스크롤을 막고 풀면 원래 값으로 되돌린다", () => {
      document.documentElement.style.overflow = "auto";
      const { rerender } = renderHook(({ locked }) => useLockScroll(locked), {
        initialProps: { locked: true },
      });
      expect(overflow()).toBe("hidden");

      rerender({ locked: false });

      expect(overflow()).toBe("auto");
    });

    it("잠그지 않으면 스크롤 설정을 건드리지 않는다", () => {
      document.documentElement.style.overflow = "auto";

      renderHook(() => useLockScroll(false));

      expect(overflow()).toBe("auto");
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("두 곳이 잠그면 연 순서와 상관없이 마지막 하나가 풀릴 때만 되돌린다", () => {
      document.documentElement.style.overflow = "auto";
      const first = renderHook(() => useLockScroll(true));
      const second = renderHook(() => useLockScroll(true));

      first.unmount();
      expect(overflow()).toBe("hidden");

      second.unmount();
      expect(overflow()).toBe("auto");
    });
  });
});
