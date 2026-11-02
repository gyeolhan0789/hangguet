import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/stores/toast-store";
import type { MeResponse, PracticeAlarmResponse } from "@/types/api";

import { SettingsView } from "./settings-view";

// 서버 액션 경계만 바꾼다. 줄마다의 요청은 각 줄 테스트 · actions.test.ts · E2E(settings.spec.ts)가 본다.
const dismissNotice = vi.fn();
vi.mock("@/lib/auth/social-actions", () => ({
  dismissNotice: (...args: unknown[]) => dismissNotice(...args),
}));
vi.mock("@/lib/auth/actions", () => ({ logout: vi.fn() }));
vi.mock("@/lib/user/actions", () => ({
  changeNickname: vi.fn(),
  changePassword: vi.fn(),
  changePracticeAlarmTime: vi.fn(),
  createProfileImageUploadUrl: vi.fn(),
  deleteProfileImage: vi.fn(),
  disablePracticeAlarm: vi.fn(),
  registerProfileImage: vi.fn(),
  startKakaoAlarm: vi.fn(),
  withdraw: vi.fn(),
  withdrawSocial: vi.fn(),
}));

// 기준: Figma S09-1 Row 카카오(436:2096: '카카오' · '연결하기', 누를 수 없음) · S09-1-B(436:2104: '연결됨' · '비밀번호 변경' 비활성)
// · 기획 메모 S09-1 · S09-1-B(2.1 socialProvider: KAKAO면 '연결됨', null이면 '연결하기'(API 없어 비활성), 소셜 회원은 2.3을 쓸 수 없음)

const EMAIL_MEMBER = {
  id: 1,
  email: "example@ssafy.com",
  nickname: "면접왕",
  socialProvider: null,
  profileImageUrl: null,
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
} satisfies MeResponse;
const KAKAO_MEMBER = {
  ...EMAIL_MEMBER,
  email: "a@kakao.com",
  socialProvider: "KAKAO",
} satisfies MeResponse;
const ALARM = { available: false, enabled: false, time: "21:00" } satisfies PracticeAlarmResponse;

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  useToastStore.setState({ toast: null });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  MotionGlobalConfig.skipAnimations = false;
});

const account = () => within(screen.getByRole("region", { name: "계정" }));

describe("SettingsView 카카오 줄 · 비밀번호 변경", () => {
  it("이메일 회원: 카카오 '연결하기'(누를 수 없음), 비밀번호 변경은 누를 수 있다", () => {
    render(<SettingsView me={EMAIL_MEMBER} alarm={ALARM} />);

    expect(account().getByText("연결하기")).toBeTruthy();
    const password = account().getByRole("button", { name: /비밀번호 변경/ }) as HTMLButtonElement;
    expect(password.disabled).toBe(false);
  });

  it("카카오 회원: '연결됨', 비밀번호가 없어 비밀번호 변경은 누를 수 없다", () => {
    render(<SettingsView me={KAKAO_MEMBER} alarm={{ ...ALARM, available: true }} />);

    expect(account().getByText("연결됨")).toBeTruthy();
    const password = account().getByRole("button", { name: "비밀번호 변경" }) as HTMLButtonElement;
    expect(password.disabled).toBe(true);
  });

  it.each([
    ["이메일 회원은 비밀번호 칸이 있는", EMAIL_MEMBER, true],
    ["카카오 회원은 비밀번호 칸이 없는", KAKAO_MEMBER, false],
  ])("[회원 탈퇴]를 누르면 %s 확인 모달을 연다", (_, me, hasPassword) => {
    render(<SettingsView me={me} alarm={ALARM} />);

    fireEvent.click(screen.getByRole("button", { name: "회원 탈퇴" }));

    expect(screen.getByRole("dialog", { name: "정말 탈퇴할까요?" })).toBeTruthy();
    expect(screen.queryByLabelText("비밀번호", { selector: "input" }) !== null).toBe(hasPassword);
  });
});

describe("SettingsView 알림 켜기 실패 문구", () => {
  it("콜백이 남긴 문구를 토스트로 한 번 보이고 문구 쿠키를 지운다", async () => {
    await act(async () => {
      render(
        <SettingsView
          me={KAKAO_MEMBER}
          alarm={{ ...ALARM, available: true }}
          notice="가입할 때 쓴 카카오 계정으로 동의해 주세요."
        />,
      );
    });

    expect(screen.getByRole("status").textContent).toBe(
      "가입할 때 쓴 카카오 계정으로 동의해 주세요.",
    );
    expect(dismissNotice).toHaveBeenCalledOnce();
  });

  it("개발 모드(StrictMode)에서 효과가 두 번 돌아도 토스트가 남는다", async () => {
    await act(async () => {
      render(
        <SettingsView
          me={KAKAO_MEMBER}
          alarm={{ ...ALARM, available: true }}
          notice="가입할 때 쓴 카카오 계정으로 동의해 주세요."
        />,
        { reactStrictMode: true },
      );
    });

    expect(screen.getByRole("status").textContent).toBe(
      "가입할 때 쓴 카카오 계정으로 동의해 주세요.",
    );
  });

  it("문구가 없으면 토스트를 띄우지 않는다", () => {
    render(<SettingsView me={EMAIL_MEMBER} alarm={ALARM} />);

    expect(screen.getByRole("status").textContent).toBe("");
    expect(dismissNotice).not.toHaveBeenCalled();
  });
});
