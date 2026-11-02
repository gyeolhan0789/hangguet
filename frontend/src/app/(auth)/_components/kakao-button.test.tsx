import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KakaoButton } from "./kakao-button";

// 서버 액션 경계만 바꾼다. state 쿠키 · 카카오 인가 이동은 social-actions.test.ts와 E2E(kakao-login.spec.ts)가 본다.
const startKakaoLogin = vi.fn();
vi.mock("@/lib/auth/social-actions", () => ({
  startKakaoLogin: (...args: unknown[]) => startKakaoLogin(...args),
}));

// 기준: Figma S01 · S01-1 카카오 버튼(434:2095 · 434:2099) · 기획 메모 S01-3(423:2140: [카카오 로그인] → 카카오 동의 화면)
// 외부 화면으로 넘어가는 서버 액션은 끝나지 않으므로, 테스트가 끝날 때 직접 푼다.

const releases: (() => void)[] = [];
function pending() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  releases.push(release);
  return promise;
}

afterEach(async () => {
  await act(async () => releases.splice(0).forEach((release) => release()));
  cleanup();
  vi.resetAllMocks();
});

const button = () => screen.getByRole("button", { name: "카카오로 시작하기" }) as HTMLButtonElement;

describe("KakaoButton", () => {
  it("누르면 카카오 로그인을 시작하고, 넘어가는 동안 다시 누를 수 없다", async () => {
    startKakaoLogin.mockReturnValue(pending());
    render(<KakaoButton height="h-[54px]">카카오로 시작하기</KakaoButton>);

    await act(async () => fireEvent.click(button()));

    expect(startKakaoLogin).toHaveBeenCalledOnce();
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");
  });

  it("카카오 화면에서 뒤로 가기로 되살아나면(bfcache) 다시 누를 수 있고, 일반 pageshow는 그대로 둔다", async () => {
    startKakaoLogin.mockReturnValue(pending());
    render(<KakaoButton>카카오로 시작하기</KakaoButton>);
    await act(async () => fireEvent.click(button()));

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect(button().disabled).toBe(true);

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(button().disabled).toBe(false);
  });
});
