// 기준: Figma S01 · S01-1 카카오 버튼(434:2095 · 434:2099) · 기획 메모 S01-3(423:2140: [카카오 로그인] → 카카오 동의 화면 → 콜백)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { startKakaoLogin } from "@/lib/auth/social-actions";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { KakaoButton } from "./kakao-button";

// 경계 mock: 서버 액션(카카오 인가 시작). state 쿠키 · 인가 이동은 social-actions 테스트와 E2E가 본다
vi.mock("@/lib/auth/social-actions", () => ({ startKakaoLogin: vi.fn() }));

/** 카카오 화면으로 넘어가는 서버 액션은 끝나지 않는다. 테스트가 마지막 줄에서 직접 끝낸다 */
function leaveToKakao() {
  const action = deferred<void>();
  vi.mocked(startKakaoLogin).mockReturnValue(action.promise);
  return action;
}

const button = () => screen.getByRole("button", { name: "카카오 로그인" }) as HTMLButtonElement;

describe("KakaoButton · 카카오 로그인 버튼", () => {
  describe("상태 변화", () => {
    it("뒤로 가기로 되살아나면(pageshow persisted) 다시 누를 수 있다", async () => {
      const action = leaveToKakao();
      render(<KakaoButton>카카오 로그인</KakaoButton>);
      fireEvent.click(button());
      await flushPromises();

      fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));

      expect(button().disabled).toBe(false);
      await act(async () => action.resolve());
    });

    it("일반 pageshow면 넘어가는 중인 채 그대로 둔다", async () => {
      const action = leaveToKakao();
      render(<KakaoButton>카카오 로그인</KakaoButton>);
      fireEvent.click(button());
      await flushPromises();

      fireEvent(window, new PageTransitionEvent("pageshow", { persisted: false }));

      expect(button().disabled).toBe(true);
      await act(async () => action.resolve());
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("카카오 화면으로 넘어가는 동안에는 다시 누를 수 없다", async () => {
      const action = leaveToKakao();
      render(<KakaoButton>카카오 로그인</KakaoButton>);
      fireEvent.click(button());
      await flushPromises();

      fireEvent.click(button());
      await flushPromises();

      expect(button().disabled).toBe(true);
      expect(startKakaoLogin).toHaveBeenCalledTimes(1);
      await act(async () => action.resolve());
    });
  });

  describe("정리", () => {
    it("언마운트하면 pageshow 리스너를 뗀다", () => {
      const addEventListener = vi.spyOn(window, "addEventListener");
      const { unmount } = render(<KakaoButton>카카오 로그인</KakaoButton>);
      const onPageShow = addEventListener.mock.calls.find(([type]) => type === "pageshow")?.[1];
      const removeEventListener = vi.spyOn(window, "removeEventListener");

      unmount();

      expect(onPageShow).toBeDefined();
      expect(removeEventListener).toHaveBeenCalledWith("pageshow", onPageShow);
    });
  });
});
