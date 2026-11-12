// 기준: 사용자 결정(2026-10-22: 인터넷이 끊기면 기다렸다가 다시 연결되면 이어서 조회) · MDN navigator.onLine · online/offline 이벤트
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useOnline } from "./use-online";

// 경계 mock: 브라우저 연결 상태(navigator.onLine)

function Probe() {
  return String(useOnline());
}

describe("useOnline · 온라인 여부", () => {
  describe("정상 처리", () => {
    it("처음에 브라우저가 오프라인이면 false를 돌려준다", () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      const { result } = renderHook(() => useOnline());

      expect(result.current).toBe(false);
    });

    it("서버에서 그릴 때는 온라인으로 본다", () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      expect(renderToString(createElement(Probe))).toBe("true");
    });
  });

  describe("상태 변화", () => {
    it("offline 이벤트가 오면 false로, online 이벤트가 오면 true로 바뀐다", () => {
      const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      const { result } = renderHook(() => useOnline());

      onLine.mockReturnValue(false);
      act(() => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(result.current).toBe(false);

      onLine.mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      expect(result.current).toBe(true);
    });
  });

  describe("정리", () => {
    it("언마운트하면 online · offline 리스너를 뗀다", () => {
      const addEventListener = vi.spyOn(window, "addEventListener");
      const { unmount } = renderHook(() => useOnline());
      const added = (type: string) =>
        addEventListener.mock.calls.find(([name]) => name === type)?.[1];
      const removeEventListener = vi.spyOn(window, "removeEventListener");

      unmount();

      expect(added("online")).toBeDefined();
      expect(removeEventListener).toHaveBeenCalledWith("online", added("online"));
      expect(removeEventListener).toHaveBeenCalledWith("offline", added("offline"));
    });
  });
});
