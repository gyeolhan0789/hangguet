// 기준: Figma S09-1 설정(18:3157) · S09-1-B(436:2104: 소셜 회원은 '비밀번호 변경' 누를 수 없음) · Swagger 2.1 내 정보(MeResponse)
// · 2.8 연습 알림 설정 · 기획 메모 S09-1 · S09-1-B(알림 켜기 · 계정 연결 실패는 토스트)
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dismissNotice } from "@/lib/auth/social-actions";
import { useToastStore } from "@/stores/toast-store";
import type { MeResponse, PracticeAlarmResponse } from "@/types/api";

import { SettingsView } from "./settings-view";

// 경계 mock: 서버 액션(설정 줄 · 로그아웃 · 문구 쿠키 지우기)과 연출(motion)
vi.mock("@/lib/user/actions", () => ({
  changeNickname: vi.fn(),
  changePassword: vi.fn(),
  changePracticeAlarmTime: vi.fn(),
  createProfileImageUploadUrl: vi.fn(),
  deleteProfileImage: vi.fn(),
  disablePracticeAlarm: vi.fn(),
  registerProfileImage: vi.fn(),
  startKakaoAlarm: vi.fn(),
  startKakaoLink: vi.fn(),
  unlinkKakao: vi.fn(),
  withdraw: vi.fn(),
  withdrawSocial: vi.fn(),
}));
vi.mock("@/lib/auth/actions", () => ({ logout: vi.fn() }));
vi.mock("@/lib/auth/social-actions", () => ({ dismissNotice: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 2.1 200 예시(이메일 회원) · 카카오 가입 회원 · 2.8 200 예시
const EMAIL_MEMBER: MeResponse = {
  id: 1,
  email: "example@ssafy.com",
  nickname: "면접왕",
  socialProvider: null,
  linkedProvider: null,
  profileImageUrl: null,
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
};
const KAKAO_MEMBER: MeResponse = {
  ...EMAIL_MEMBER,
  email: "a@kakao.com",
  socialProvider: "KAKAO",
};
const ALARM: PracticeAlarmResponse = { available: false, enabled: false, time: "21:00" };
const NOTICE = "카카오 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";

const passwordRow = () => screen.getByRole("button", { name: /비밀번호 변경/ });

beforeEach(() => {
  useToastStore.setState({ toast: null });
});

describe("SettingsView · 설정 화면", () => {
  describe("화면 표시", () => {
    it("이메일 회원이면 비밀번호 변경 줄을 누를 수 있다", () => {
      render(<SettingsView me={EMAIL_MEMBER} alarm={ALARM} />);

      expect(passwordRow().hasAttribute("disabled")).toBe(false);
    });

    it("소셜 회원이면 비밀번호 변경을 누를 수 없다", () => {
      render(<SettingsView me={KAKAO_MEMBER} alarm={ALARM} />);

      expect(passwordRow().hasAttribute("disabled")).toBe(true);
    });

    it("콜백이 남긴 문구가 있으면 토스트로 보이고 문구 쿠키를 지운다", () => {
      render(<SettingsView me={EMAIL_MEMBER} alarm={ALARM} notice={NOTICE} />);

      expect(screen.getByRole("status").textContent).toContain(NOTICE);
      expect(dismissNotice).toHaveBeenCalledTimes(1);
    });

    it("콜백이 남긴 문구가 없으면 토스트를 띄우지 않고 쿠키도 지우지 않는다", () => {
      render(<SettingsView me={EMAIL_MEMBER} alarm={ALARM} />);

      expect(screen.getByRole("status").textContent).toBe("");
      expect(dismissNotice).not.toHaveBeenCalled();
    });
  });

  describe("사용자 조작", () => {
    it("[회원 탈퇴]를 누르면 탈퇴 확인 모달을 연다", () => {
      render(<SettingsView me={EMAIL_MEMBER} alarm={ALARM} />);

      fireEvent.click(screen.getByRole("button", { name: "회원 탈퇴" }));

      expect(screen.getByRole("dialog", { name: "정말 탈퇴할까요?" })).toBeDefined();
    });

    it("소셜 회원이 [회원 탈퇴]를 누르면 비밀번호 칸 없는 탈퇴 모달을 연다", () => {
      render(<SettingsView me={KAKAO_MEMBER} alarm={ALARM} />);

      fireEvent.click(screen.getByRole("button", { name: "회원 탈퇴" }));

      expect(screen.getByRole("dialog", { name: "정말 탈퇴할까요?" })).toBeDefined();
      expect(screen.queryByLabelText("비밀번호", { selector: "input" })).toBeNull();
    });
  });
});
