// 기준: Figma S01-3 카카오 가입 · 약관 동의 모달(435:2189) · 기획 메모 S01-3(423:2140: 필수 약관 모두 체크해야 버튼 활성 → 1.7,
// ✕로 닫으면 가입 안 함(가입 토큰 삭제)) · Swagger 1.7 소셜 회원가입 · 사용자 결정(2026-10-30: 만 14세 이상 확인)
// · WAI-ARIA 대화 상자 패턴(열리면 포커스, Esc로 닫힘, 안에서만 Tab, 닫으면 포커스를 돌려줌)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { cancelSocialSignup, socialSignup } from "@/lib/auth/social-actions";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { SocialSignupModal } from "./social-signup-modal";

// 경계 mock: 서버 액션(1.7 가입 · 가입 토큰 지우기)과 연출(motion: 닫히는 순간 onExitComplete)
vi.mock("@/lib/auth/social-actions", () => ({
  socialSignup: vi.fn(),
  cancelSocialSignup: vi.fn(),
}));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

/** S01 로그인 폼의 이메일 칸과 함께 그린다(닫은 뒤 포커스가 돌아갈 곳) */
function renderOnLogin() {
  return render(
    <>
      <input id="email" aria-label="이메일" />
      <SocialSignupModal />
    </>,
  );
}

const dialog = () => screen.getByRole("dialog", { name: "회원가입" });
const submit = () => screen.getByRole("button", { name: "가입하고 시작하기" }) as HTMLButtonElement;
const checkbox = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

async function agreeAll() {
  fireEvent.click(checkbox("전체 동의"));
  await flushPromises();
}

describe("SocialSignupModal · 카카오 가입 약관 동의 모달", () => {
  describe("화면 표시", () => {
    it("열리면 모달로 포커스를 옮긴다", () => {
      renderOnLogin();

      expect(document.activeElement).toBe(dialog());
    });

    it("필수 동의 4개를 모두 체크해야 [가입하고 시작하기]를 누를 수 있다", async () => {
      renderOnLogin();
      expect(submit().disabled).toBe(true);

      await agreeAll();

      expect(submit().disabled).toBe(false);
    });
  });

  describe("사용자 조작", () => {
    it("[전체 동의]를 누르면 동의 4개를 모두 체크한다", async () => {
      renderOnLogin();

      await agreeAll();

      expect(
        [
          "[필수] 만 14세 이상입니다",
          "[필수] 이용약관",
          "[필수] 개인정보 수집 · 이용",
          "[필수] 면접 녹화 · 음성 이용",
        ].map((name) => checkbox(name).checked),
      ).toEqual([true, true, true, true]);
    });

    it("[가입하고 시작하기]를 누르면 동의 값으로 가입을 요청한다", async () => {
      vi.mocked(socialSignup).mockResolvedValue(undefined);
      renderOnLogin();
      await agreeAll();

      fireEvent.click(submit());
      await flushPromises();

      expect(socialSignup).toHaveBeenCalledWith({
        AGE: true,
        TERMS: true,
        PRIVACY: true,
        RECORDING: true,
      });
    });

    it("✕를 누르면 모달을 닫고 가입 토큰을 지운 뒤 이메일 칸으로 포커스를 돌려준다", () => {
      renderOnLogin();

      fireEvent.click(screen.getByRole("button", { name: "닫기" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(cancelSocialSignup).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(screen.getByLabelText("이메일"));
    });

    it("Esc를 누르면 모달을 닫는다", () => {
      renderOnLogin();

      fireEvent.keyDown(dialog(), { key: "Escape" });

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("[보기] 본문 안에서 누른 Esc는 본문만 닫고 가입 모달은 그대로 둔다", () => {
      renderOnLogin();
      fireEvent.click(screen.getByRole("button", { name: "서비스 이용약관 보기" }));

      fireEvent.keyDown(screen.getByRole("dialog", { name: "서비스 이용약관" }), {
        key: "Escape",
      });

      expect(screen.queryByRole("dialog", { name: "서비스 이용약관" })).toBeNull();
      expect(dialog()).toBeDefined();
      expect(cancelSocialSignup).not.toHaveBeenCalled();
    });

    it("마지막 항목에서 Tab을 누르면 모달의 처음 항목으로 돈다", () => {
      renderOnLogin();
      const last = screen.getByRole("button", { name: "면접 녹화 · 음성 이용 동의 보기" });
      last.focus();

      fireEvent.keyDown(last, { key: "Tab" });

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "닫기" }));
    });

    it("어두운 바깥을 눌러도 포커스가 모달 밖으로 나가지 않는다", () => {
      renderOnLogin();
      const dim = dialog().parentElement!;

      expect(fireEvent.mouseDown(dim)).toBe(false);
    });

    it("모달 안을 누르면 포커스 이동을 막지 않는다", () => {
      renderOnLogin();

      expect(fireEvent.mouseDown(checkbox("전체 동의"))).toBe(true);
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("가입을 기다리는 동안에는 ✕를 누를 수 없고 Esc로도 닫히지 않는다", async () => {
      const signing = deferred<undefined>();
      vi.mocked(socialSignup).mockReturnValue(signing.promise);
      renderOnLogin();
      await agreeAll();
      fireEvent.click(submit());
      await flushPromises();

      fireEvent.keyDown(dialog(), { key: "Escape" });

      expect((screen.getByRole("button", { name: "닫기" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(dialog()).toBeDefined();
      expect(cancelSocialSignup).not.toHaveBeenCalled();
      await act(async () => signing.resolve(undefined));
    });
  });
});
