// 기준: Figma S01-1 회원가입 · Swagger 1.1 이메일 중복 확인 · 1.2 회원가입 · SignupRequest
// · 사용자 결정(2026-10-30: 만 14세 이상 확인)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkEmailAvailable, signup, type AuthActionResult } from "@/lib/auth/actions";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { SignupForm } from "./signup-form";

// 경계 mock: 서버 액션(1.1 · 1.2 · 카카오 인가 시작)과 연출(motion). 이메일 확인 0.4초는 가짜 타이머로 넘긴다
vi.mock("@/lib/auth/actions", () => ({ signup: vi.fn(), checkEmailAvailable: vi.fn() }));
vi.mock("@/lib/auth/social-actions", () => ({ startKakaoLogin: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

beforeEach(() => {
  vi.useFakeTimers();
});

const EMAIL = "a@ssafy.com";
const VALID = "abcd1234";
const AVAILABLE = "사용할 수 있는 이메일이에요";

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const submitButton = () =>
  screen.getByRole("button", { name: "가입하고 시작하기" }) as HTMLButtonElement;
const alerts = () => screen.queryAllByRole("alert").map((alert) => alert.textContent);

async function type(label: string, value: string) {
  fireEvent.change(input(label), { target: { value } });
  await flushPromises();
}

/** 이메일 확인 대기 시간을 넘기고 확인 결과까지 반영한다 */
async function pass(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flushPromises();
}

/** 이메일 확인 결과를 빼고 모든 칸을 맞게 채운다 */
async function fillOtherFields() {
  await type("닉네임", "면접왕");
  await type("비밀번호", VALID);
  await type("비밀번호 확인", VALID);
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  await flushPromises();
}

/** 모든 칸을 맞게 채우고 이메일을 쓸 수 있다고 확인받는다 */
async function fillAll() {
  vi.mocked(checkEmailAvailable).mockResolvedValue(true);
  await fillOtherFields();
  await type("이메일", EMAIL);
  await pass(400);
}

describe("SignupForm · 회원가입 폼", () => {
  describe("이메일 중복 확인", () => {
    describe("화면 표시", () => {
      it("확인을 기다리는 동안 '사용할 수 있는지 확인하는 중…'을 보인다", async () => {
        const check = deferred<boolean | null>();
        vi.mocked(checkEmailAvailable).mockReturnValue(check.promise);
        render(<SignupForm onComplete={vi.fn()} />);

        await type("이메일", EMAIL);
        await pass(400);

        expect(screen.getByText("사용할 수 있는지 확인하는 중…")).toBeDefined();
        await act(async () => check.resolve(true));
      });

      it.each([
        { label: "true", available: true, text: AVAILABLE },
        { label: "false", available: false, text: "이미 사용 중인 이메일이에요." },
        {
          label: "null",
          available: null,
          text: "이메일을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        },
      ])("확인 결과가 '$label'이면 '$text'를 보인다", async ({ available, text }) => {
        vi.mocked(checkEmailAvailable).mockResolvedValue(available);
        render(<SignupForm onComplete={vi.fn()} />);

        await type("이메일", EMAIL);
        await pass(400);

        expect(screen.getByText(text)).toBeDefined();
      });

      it("형식 오류가 있으면 확인 결과 대신 형식 안내를 보인다", async () => {
        vi.mocked(checkEmailAvailable).mockResolvedValue(true);
        render(<SignupForm onComplete={vi.fn()} />);
        await type("이메일", EMAIL);
        await pass(400);

        await type("이메일", "a@");

        expect(alerts()).toEqual(["이메일 형식을 확인해 주세요."]);
        expect(screen.queryByText(AVAILABLE)).toBeNull();
      });
    });

    describe("입력 검증", () => {
      it("형식이 틀리면 확인하지 않는다", async () => {
        render(<SignupForm onComplete={vi.fn()} />);

        await type("이메일", "not-email");
        await pass(400);

        expect(checkEmailAvailable).not.toHaveBeenCalled();
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("늦게 온 이전 이메일의 결과는 무시한다", async () => {
        const first = deferred<boolean | null>();
        const second = deferred<boolean | null>();
        vi.mocked(checkEmailAvailable)
          .mockReturnValueOnce(first.promise)
          .mockReturnValueOnce(second.promise);
        render(<SignupForm onComplete={vi.fn()} />);
        await type("이메일", "old@ssafy.com");
        await pass(400);
        await type("이메일", EMAIL);
        await pass(400);

        await act(async () => second.resolve(true));
        await act(async () => first.resolve(false));

        expect(screen.queryByText("이미 사용 중인 이메일이에요.")).toBeNull();
      });
    });

    describe("시간 경과", () => {
      it("형식이 맞는 이메일을 입력하고 0.4초가 지나면 확인한다", async () => {
        vi.mocked(checkEmailAvailable).mockResolvedValue(true);
        render(<SignupForm onComplete={vi.fn()} />);
        await type("이메일", EMAIL);

        await pass(399);
        expect(checkEmailAvailable).not.toHaveBeenCalled();

        await pass(1);
        expect(checkEmailAvailable).toHaveBeenCalledWith(EMAIL);
      });

      it("0.4초가 되기 전에 다시 입력하면 마지막 이메일만 확인한다", async () => {
        vi.mocked(checkEmailAvailable).mockResolvedValue(true);
        render(<SignupForm onComplete={vi.fn()} />);
        await type("이메일", "old@ssafy.com");
        await pass(200);

        await type("이메일", EMAIL);
        await pass(400);

        expect(checkEmailAvailable).toHaveBeenCalledTimes(1);
        expect(checkEmailAvailable).toHaveBeenCalledWith(EMAIL);
      });
    });
  });

  describe("비밀번호", () => {
    describe("화면 표시", () => {
      it("비밀번호가 64자 이하면 규칙 오류 문구 대신 칩만 보인다", async () => {
        render(<SignupForm onComplete={vi.fn()} />);

        await type("비밀번호", "a".repeat(64));

        expect(alerts()).toEqual([]);
        expect(screen.getByRole("list")).toBeDefined();
      });

      it("비밀번호가 64자를 넘으면 칸 아래에 최대 길이 안내를 보인다", async () => {
        render(<SignupForm onComplete={vi.fn()} />);

        await type("비밀번호", `a1${"a".repeat(63)}`);

        expect(alerts()).toEqual(["비밀번호는 64자까지 쓸 수 있어요."]);
      });
    });

    describe("상태 변화", () => {
      it("확인 칸을 채운 뒤 비밀번호를 바꾸면 확인 칸을 다시 비교한다", async () => {
        render(<SignupForm onComplete={vi.fn()} />);
        await type("비밀번호", VALID);
        await type("비밀번호 확인", VALID);

        await type("비밀번호", "abcd12345");

        expect(alerts()).toEqual(["비밀번호가 일치하지 않아요."]);
      });
    });
  });

  describe("약관 동의", () => {
    describe("사용자 조작", () => {
      it("[전체 동의]를 누르면 동의 4개를 모두 체크하고, 다시 누르면 모두 푼다", async () => {
        render(<SignupForm onComplete={vi.fn()} />);
        const names = [
          "[필수] 만 14세 이상입니다",
          "[필수] 이용약관",
          "[필수] 개인정보 수집 · 이용",
          "[필수] 면접 녹화 · 음성 이용",
        ];
        const states = () =>
          names.map((name) => (screen.getByRole("checkbox", { name }) as HTMLInputElement).checked);

        fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
        await flushPromises();
        expect(states()).toEqual([true, true, true, true]);

        fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
        await flushPromises();
        expect(states()).toEqual([false, false, false, false]);
      });
    });
  });

  describe("가입", () => {
    describe("화면 표시", () => {
      it("모든 칸이 맞고 이메일을 쓸 수 있다고 확인돼야 [가입하고 시작하기]를 누를 수 있다", async () => {
        render(<SignupForm onComplete={vi.fn()} />);
        expect(submitButton().disabled).toBe(true);

        await fillAll();

        expect(submitButton().disabled).toBe(false);
      });

      it.each([
        { label: "사용 중", available: false },
        { label: "확인 실패", available: null },
      ])("이메일 확인 결과가 '$label'이면 다른 칸이 맞아도 누를 수 없다", async ({ available }) => {
        vi.mocked(checkEmailAvailable).mockResolvedValue(available);
        render(<SignupForm onComplete={vi.fn()} />);
        await fillOtherFields();
        await type("이메일", EMAIL);

        await pass(400);

        expect(submitButton().disabled).toBe(true);
      });

      it("이메일을 확인하는 중이면 다른 칸이 맞아도 누를 수 없다", async () => {
        const check = deferred<boolean | null>();
        vi.mocked(checkEmailAvailable).mockReturnValue(check.promise);
        render(<SignupForm onComplete={vi.fn()} />);
        await fillOtherFields();
        await type("이메일", EMAIL);

        await pass(400);

        expect(submitButton().disabled).toBe(true);
        await act(async () => check.resolve(true));
      });
    });

    describe("사용자 조작", () => {
      it("가입하면 완료를 알린다", async () => {
        vi.mocked(signup).mockResolvedValue({ ok: true });
        const onComplete = vi.fn();
        render(<SignupForm onComplete={onComplete} />);
        await fillAll();

        fireEvent.click(submitButton());
        await flushPromises();

        expect(onComplete).toHaveBeenCalledTimes(1);
      });
    });

    describe("오류 처리", () => {
      it("서버가 칸을 거절하면 닉네임 · 이메일 · 비밀번호 칸 아래에 이유를 보인다", async () => {
        vi.mocked(signup).mockResolvedValue({
          fieldErrors: {
            nickname: "닉네임은 50자까지 쓸 수 있어요.",
            email: "이미 가입한 이메일이에요.",
            password: "8~64자, 영문과 숫자를 모두 포함해야 합니다.",
          },
        });
        render(<SignupForm onComplete={vi.fn()} />);
        await fillAll();

        fireEvent.click(submitButton());
        await flushPromises();

        expect(alerts()).toEqual([
          "닉네임은 50자까지 쓸 수 있어요.",
          "이미 가입한 이메일이에요.",
          "8~64자, 영문과 숫자를 모두 포함해야 합니다.",
        ]);
        expect(input("비밀번호").getAttribute("aria-invalid")).toBe("true");
      });

      it("서버가 폼 오류를 주면 폼 아래에 보인다", async () => {
        vi.mocked(signup).mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
        render(<SignupForm onComplete={vi.fn()} />);
        await fillAll();

        fireEvent.click(submitButton());
        await flushPromises();

        expect(alerts()).toEqual(["잠시 후 다시 시도해 주세요."]);
      });

      it("다시 가입하면 이전 폼 오류를 지운다", async () => {
        vi.mocked(signup).mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
        render(<SignupForm onComplete={vi.fn()} />);
        await fillAll();
        fireEvent.click(submitButton());
        await flushPromises();
        const second = deferred<AuthActionResult>();
        vi.mocked(signup).mockReturnValue(second.promise);

        fireEvent.click(submitButton());
        await flushPromises();

        expect(alerts()).toEqual([]);
        await act(async () => second.resolve({ ok: true }));
      });
    });
  });
});
