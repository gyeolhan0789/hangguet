import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { Activity } from "react";
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
  startKakaoLink: vi.fn(),
  unlinkKakao: vi.fn(),
  withdraw: vi.fn(),
  withdrawSocial: vi.fn(),
}));

// 기준: Figma S09-1 Row 카카오(436:2096: '카카오' · '연결하기') · S09-1-B(436:2104: '연결됨' · '비밀번호 변경' 비활성)
// · 기획 메모 S09-1 · S09-1-B(2.1 socialProvider: KAKAO면 '연결됨', 소셜 회원은 2.3을 쓸 수 없음) · 카카오 줄의 연결 · 해제 동작은
// kakao-row.test.tsx가 본다(사용자 결정: 연결하고 돌아오면 '연결이 완료되었어요' 안내 모달)

const EMAIL_MEMBER = {
  id: 1,
  email: "example@ssafy.com",
  nickname: "면접왕",
  socialProvider: null,
  linkedProvider: null,
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
  // Next.js는 다른 화면으로 가면 이 화면을 지우지 않고 <Activity>로 숨긴다(Preserving UI State). 다시 와도 펼쳐 둔 편집칸 ·
  // 입력한 비밀번호가 남지 않아야 한다(사용자 결정 2026-11-05).
  it("화면이 숨겨지면 비밀번호 변경 · 닉네임 편집을 접고, 입력한 비밀번호를 지운다", async () => {
    const view = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <SettingsView me={EMAIL_MEMBER} alarm={ALARM} />
      </Activity>
    );
    const { rerender } = render(view("visible"));
    fireEvent.click(account().getByRole("button", { name: /비밀번호 변경/ }));
    fireEvent.change(screen.getByLabelText("지금 비밀번호", { selector: "input" }), {
      target: { value: "abcd1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /닉네임/ }));
    expect(screen.getByRole("textbox", { name: "닉네임" })).toBeTruthy();

    rerender(view("hidden"));
    rerender(view("visible"));

    const password = account().getByRole("button", { name: /비밀번호 변경/ });
    expect(password.getAttribute("aria-expanded")).toBe("false");
    // 편집칸이 접히면 닉네임 줄(버튼)이 다시 나온다(jsdom은 사라지는 연출이 끝나지 않아 입력칸 자리가 남을 수 있다)
    await waitFor(() =>
      expect(screen.getAllByRole("button").some((b) => b.textContent?.startsWith("닉네임"))).toBe(
        true,
      ),
    );
    fireEvent.click(password);
    expect(
      (screen.getByLabelText("지금 비밀번호", { selector: "input" }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("이메일 회원: 카카오 '연결하기' 줄을 누를 수 있고, 비밀번호 변경도 누를 수 있다", () => {
    render(<SettingsView me={EMAIL_MEMBER} alarm={ALARM} />);

    expect(account().getByRole("button", { name: /카카오\s*연결하기/ })).toBeTruthy();
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

describe("SettingsView 카카오 계정 연결 완료", () => {
  it("연결하고 돌아오면(linked) 카카오 줄에 안내 모달을 띄운다", async () => {
    await act(async () => {
      render(
        <SettingsView me={{ ...EMAIL_MEMBER, linkedProvider: "KAKAO" }} alarm={ALARM} linked />,
      );
    });

    expect(screen.getByRole("dialog", { name: "연결이 완료되었어요" })).toBeTruthy();
  });

  it("연결하고 돌아온 게 아니면 안내 모달이 없다", () => {
    render(<SettingsView me={{ ...EMAIL_MEMBER, linkedProvider: "KAKAO" }} alarm={ALARM} />);

    expect(screen.queryByRole("dialog")).toBeNull();
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
