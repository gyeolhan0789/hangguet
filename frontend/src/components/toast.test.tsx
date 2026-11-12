// 기준: Figma 토스트(S06-F Mic Toast 18:4421: 아이콘 18 + 15 SemiBold 문구) · 화면에 하나뿐인 토스트(useToastStore) · 2초 뒤 사라짐
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/stores/toast-store";

import { Toast, TOAST_MS } from "./toast";

// 경계 mock: 연출(motion)은 건너뛴다. 시간은 가짜 타이머로 직접 진행한다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

const status = () => screen.getByRole("status");
const show = (text: string) => act(() => useToastStore.getState().show({ text }));
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00:00+09:00"));
  useToastStore.setState({ toast: null });
});

describe("Toast · 화면 아래 토스트", () => {
  describe("중복 · 경쟁 처리", () => {
    it("떠 있는 동안 새 토스트를 띄우면 새 토스트부터 2초를 다시 센다", () => {
      render(<Toast />);
      show("첫 번째");
      advance(TOAST_MS - 500);

      show("두 번째");
      advance(500);
      expect(status().textContent).toBe("두 번째");

      advance(TOAST_MS - 500);
      expect(status().textContent).toBe("");
    });
  });

  describe("시간 경과", () => {
    it("띄운 뒤 2초가 지나면 토스트를 지운다", () => {
      render(<Toast />);
      show("비밀번호를 바꿨어요");

      advance(TOAST_MS);

      expect(status().textContent).toBe("");
      expect(useToastStore.getState().toast).toBeNull();
    });

    it("2초가 되기 전에는 토스트가 남아 있다", () => {
      render(<Toast />);
      show("비밀번호를 바꿨어요");

      advance(TOAST_MS - 1);

      expect(status().textContent).toBe("비밀번호를 바꿨어요");
    });
  });

  describe("정리", () => {
    it("화면을 떠나면 떠 있던 토스트를 지운다", () => {
      const { unmount } = render(<Toast />);
      show("비밀번호를 바꿨어요");

      unmount();

      expect(useToastStore.getState().toast).toBeNull();
    });
  });
});
