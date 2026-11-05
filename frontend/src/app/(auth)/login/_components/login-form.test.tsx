import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLoginNoticeStore } from "@/stores/login-notice-store";

import { LoginForm } from "./login-form";
import { LoginNotice } from "./login-notice";

// 서버 액션 경계만 바꾼다. 1.3 · 카카오 인가 이동 · 문구 쿠키는 actions.test.ts · social-actions.test.ts · E2E가 본다.
const login = vi.fn();
const dismissNotice = vi.fn();
vi.mock("@/lib/auth/actions", () => ({ login: (...args: unknown[]) => login(...args) }));
vi.mock("@/lib/auth/social-actions", () => ({
  dismissNotice: (...args: unknown[]) => dismissNotice(...args),
  startKakaoLogin: vi.fn(),
}));

// 기준: Figma S01 로그인(18:1556: [로그인] 아래 [카카오 로그인]) · 기획 메모 S01-3(423:2140: 카카오 로그인 · 가입 실패는 S01 로그인
// 버튼 위 오류 문구 자리에, 이메일 로그인 오류와 같은 자리). 모션은 끄고 본다.

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  useLoginNoticeStore.setState({ notice: null });
  MotionGlobalConfig.skipAnimations = false;
});

const alerts = () => screen.queryAllByRole("alert").map((alert) => alert.textContent);

async function submitEmailLogin() {
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "a@ssafy.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호", { selector: "input" }), {
    target: { value: "abcd1234" },
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "로그인" })));
}

describe("LoginForm (S01)", () => {
  it("[로그인] 바로 아래에 [카카오 로그인]이 있다", () => {
    render(<LoginForm />);
    const buttons = screen.getAllByRole("button");
    const emailLogin = buttons.indexOf(screen.getByRole("button", { name: "로그인" }));

    expect(emailLogin).toBeGreaterThanOrEqual(0);
    expect(buttons[emailLogin + 1]).toBe(screen.getByRole("button", { name: "카카오 로그인" }));
  });

  it("카카오 실패 문구를 오류 문구 자리에 보이고 문구 쿠키를 지운다", async () => {
    render(
      <LoginForm
        notice={
          <LoginNotice text="이미 가입한 이메일이에요. 처음 가입한 방법으로 로그인해 주세요." />
        }
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "이미 가입한 이메일이에요. 처음 가입한 방법으로 로그인해 주세요.",
    );
    expect(dismissNotice).toHaveBeenCalledOnce();
  });

  it("쿠키를 지워 화면이 다시 그려져(넘길 문구가 없어져도) 문구는 남는다", async () => {
    const { rerender } = render(
      <LoginForm notice={<LoginNotice text="가입 시간이 지났어요. 다시 로그인해 주세요." />} />,
    );
    await screen.findByRole("alert");

    rerender(<LoginForm notice={null} />);

    expect(alerts()).toEqual(["가입 시간이 지났어요. 다시 로그인해 주세요."]);
  });

  it("같은 문구가 다시 오면 새로 그려 다시 읽힌다", async () => {
    const text = "소셜 로그인에 실패했어요. 다시 시도해 주세요.";
    const { rerender } = render(<LoginForm notice={<LoginNotice key="1" text={text} />} />);
    const first = await screen.findByRole("alert");

    rerender(<LoginForm notice={<LoginNotice key="2" text={text} />} />);

    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(first));
    expect(alerts()).toEqual([text]);
  });

  it("이메일 로그인이 실패하면 그 문구가 카카오 문구를 대신한다(한 자리에 하나)", async () => {
    login.mockResolvedValue({ formError: "이메일 또는 비밀번호를 확인해 주세요." });
    render(
      <LoginForm notice={<LoginNotice text="소셜 로그인에 실패했어요. 다시 시도해 주세요." />} />,
    );
    await screen.findByRole("alert");

    await submitEmailLogin();

    await waitFor(() => expect(alerts()).toEqual(["이메일 또는 비밀번호를 확인해 주세요."]));
  });

  it("이메일 로그인 오류 뒤에 카카오 문구가 오면 카카오 문구로 바뀐다", async () => {
    login.mockResolvedValue({ formError: "이메일 또는 비밀번호를 확인해 주세요." });
    const { rerender } = render(<LoginForm />);
    await submitEmailLogin();
    await waitFor(() => expect(alerts()).toEqual(["이메일 또는 비밀번호를 확인해 주세요."]));

    rerender(
      <LoginForm notice={<LoginNotice text="가입 시간이 지났어요. 다시 로그인해 주세요." />} />,
    );

    await waitFor(() => expect(alerts()).toEqual(["가입 시간이 지났어요. 다시 로그인해 주세요."]));
  });

  it("이메일 로그인이 문구 없이 끝나면(성공해 이동 · 칸 오류만) 카카오 문구를 지운다", async () => {
    login.mockResolvedValue(undefined);
    render(
      <LoginForm notice={<LoginNotice text="소셜 로그인에 실패했어요. 다시 시도해 주세요." />} />,
    );
    await screen.findByRole("alert");

    await submitEmailLogin();

    await waitFor(() => expect(alerts()).toEqual([]));
  });

  it("화면을 떠나면 문구를 지운다(다음에 들어와도 다시 뜨지 않게)", async () => {
    const { unmount } = render(
      <LoginForm notice={<LoginNotice text="소셜 로그인에 실패했어요. 다시 시도해 주세요." />} />,
    );
    await screen.findByRole("alert");

    unmount();

    expect(useLoginNoticeStore.getState().notice).toBeNull();
  });

  // Next.js는 다른 화면으로 가면 이 화면을 지우지 않고 <Activity>로 숨긴다(Preserving UI State). 로그아웃한 뒤 다시 와도
  // 지난 이메일 · 비밀번호가 남지 않아야 한다(사용자 결정 2026-11-05).
  it("화면이 숨겨지면 입력한 이메일 · 비밀번호를 비운다", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <LoginForm />
      </Activity>,
    );
    const email = screen.getByLabelText("이메일") as HTMLInputElement;
    const password = screen.getByLabelText("비밀번호", { selector: "input" }) as HTMLInputElement;
    fireEvent.change(email, { target: { value: "a@ssafy.com" } });
    fireEvent.change(password, { target: { value: "abcd1234" } });

    rerender(
      <Activity mode="hidden">
        <LoginForm />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <LoginForm />
      </Activity>,
    );

    expect(email.value).toBe("");
    expect(password.value).toBe("");
  });

  it("개발 모드(StrictMode)에서 효과가 두 번 돌아도 문구가 남는다", async () => {
    render(
      <LoginForm notice={<LoginNotice text="가입 시간이 지났어요. 다시 로그인해 주세요." />} />,
      { reactStrictMode: true },
    );

    await waitFor(() => expect(alerts()).toEqual(["가입 시간이 지났어요. 다시 로그인해 주세요."]));
    expect(dismissNotice).toHaveBeenCalled();
  });
});
