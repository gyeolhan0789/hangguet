import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SocialSignupModal } from "./social-signup-modal";

// 서버 액션 경계만 바꾼다. 1.7 요청 · 이동 · 쿠키는 social-actions.test.ts와 E2E(kakao-login.spec.ts)가 본다.
const socialSignup = vi.fn();
const cancelSocialSignup = vi.fn();
vi.mock("@/lib/auth/social-actions", () => ({
  socialSignup: (...args: unknown[]) => socialSignup(...args),
  cancelSocialSignup: (...args: unknown[]) => cancelSocialSignup(...args),
}));

// 기준: Figma S01-3 약관 동의 모달(435:2189: '회원가입' · '카카오 계정으로 가입해요' · ✕ · 약관 동의 · [가입하고 시작하기])
// · 기획 메모 S01-3(423:2140: 필수 약관 모두 체크해야 버튼 활성 → 1.7, ✕로 닫으면 가입 안 함) · 사용자 결정(만 14세 이상 확인)
// · WAI-ARIA 대화 상자 패턴(열리면 포커스, Esc로 닫힘, 안에서만 Tab, 닫으면 포커스를 돌려줌)
// 모션은 끄고 본다. 처리 중인 1.7은 테스트가 끝날 때 푼다.

const releases: (() => void)[] = [];
function pending() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  releases.push(release);
  return promise;
}

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(async () => {
  await act(async () => releases.splice(0).forEach((release) => release()));
  cleanup();
  vi.resetAllMocks();
  MotionGlobalConfig.skipAnimations = false;
});

/** S01 로그인 폼의 이메일 칸과 함께 그린다(닫은 뒤 포커스가 돌아갈 곳) */
function renderOnLogin() {
  return render(
    <>
      <input id="email" aria-label="이메일" />
      <SocialSignupModal />
    </>,
  );
}

/** 퇴장 모션(모션을 꺼도 다음 프레임에 끝난다)과 onExitComplete까지 흘려보낸다 */
async function flushFrames() {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

const dialog = () => screen.getByRole("dialog", { name: "회원가입" });
const submit = () => screen.getByRole("button", { name: "가입하고 시작하기" }) as HTMLButtonElement;

describe("SocialSignupModal (S01-3)", () => {
  it("열리면 모달로 포커스가 가고, 부제 · 동의 줄(만 14세 + 약관 3개)을 보인다", () => {
    renderOnLogin();

    expect(document.activeElement).toBe(dialog());
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("카카오 계정으로 가입해요")).toBeTruthy();
    for (const label of [
      "[필수] 만 14세 이상입니다",
      "[필수] 이용약관",
      "[필수] 개인정보 수집 · 이용",
      "[필수] 면접 녹화 · 음성 이용",
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("필수 동의를 모두 체크해야 [가입하고 시작하기]가 켜지고, 하나라도 빠지면 다시 꺼진다", async () => {
    renderOnLogin();
    expect(submit().disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("전체 동의"));
    await waitFor(() => expect(submit().disabled).toBe(false));
    fireEvent.click(screen.getByLabelText("[필수] 이용약관"));
    await waitFor(() => expect(submit().disabled).toBe(true));
  });

  it("누르면 동의 값으로 1.7을 보내고, 처리하는 동안 ✕ · Esc로 닫지 않는다", async () => {
    socialSignup.mockReturnValue(pending());
    renderOnLogin();
    fireEvent.click(screen.getByLabelText("전체 동의"));
    await waitFor(() => expect(submit().disabled).toBe(false));

    await act(async () => fireEvent.click(submit()));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.keyDown(dialog(), { key: "Escape" });
    // 닫혔다면 사라지는 모션과 onExitComplete까지 끝난 뒤에 본다
    await flushFrames();

    expect(socialSignup).toHaveBeenCalledWith({
      AGE: true,
      TERMS: true,
      PRIVACY: true,
      RECORDING: true,
    });
    expect(dialog()).toBeTruthy();
    expect(cancelSocialSignup).not.toHaveBeenCalled();
  });

  it("✕로 닫으면 가입 토큰을 지우고(가입 안 함), 포커스를 이메일 칸으로 돌려준다", async () => {
    renderOnLogin();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "회원가입" })).toBeNull());
    expect(cancelSocialSignup).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByLabelText("이메일"));
    expect(socialSignup).not.toHaveBeenCalled();
  });

  it("Esc로 닫는다", async () => {
    renderOnLogin();

    fireEvent.keyDown(dialog(), { key: "Escape" });

    await waitFor(() => expect(cancelSocialSignup).toHaveBeenCalledOnce());
  });

  it("[보기] 본문 안에서 누른 Esc는 본문만 닫고 가입 모달은 그대로 둔다", async () => {
    renderOnLogin();

    fireEvent.click(screen.getByRole("button", { name: "서비스 이용약관 보기" }));
    const legal = await screen.findByRole("dialog", { name: "서비스 이용약관" });
    fireEvent.keyDown(legal, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "서비스 이용약관" })).toBeNull(),
    );
    expect(dialog()).toBeTruthy();
    expect(cancelSocialSignup).not.toHaveBeenCalled();
  });

  it("Tab은 모달 안에서만 돈다(마지막 [보기] ↔ ✕, 처음 모달에 있을 때 Shift+Tab은 마지막으로)", () => {
    renderOnLogin();
    const close = screen.getByRole("button", { name: "닫기" });
    const last = screen.getByRole("button", { name: "면접 녹화 · 음성 이용 동의 보기" });

    fireEvent.keyDown(dialog(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
