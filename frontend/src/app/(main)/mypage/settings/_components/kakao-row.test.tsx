import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toast } from "@/components/toast";
import { useToastStore } from "@/stores/toast-store";
import type { MeResponse } from "@/types/api";

import { KakaoRow } from "./kakao-row";

// 서버 액션 경계만 바꾼다. 카카오 동의 화면 이동 · 콜백(2.12)은 콜백 테스트와 E2E(settings.spec.ts)가 본다.
const startKakaoLink = vi.fn();
const unlinkKakao = vi.fn();
vi.mock("@/lib/user/actions", () => ({
  startKakaoLink: (...args: unknown[]) => startKakaoLink(...args),
  unlinkKakao: (...args: unknown[]) => unlinkKakao(...args),
}));
const dismissNotice = vi.fn();
vi.mock("@/lib/auth/social-actions", () => ({
  dismissNotice: (...args: unknown[]) => dismissNotice(...args),
}));

// 기준: Figma S09-1 Row 카카오(436:2096: '카카오' · '연결하기') · S09-1-B(436:2104: '연결됨') · 웹 Swagger 2.1(socialProvider
// · linkedProvider) · 2.12 연결 · 2.13 해제 · 사용자 결정(이메일 회원 '연결하기 ›' → 카카오 동의, 연결한 이메일 회원 '연결됨' + '연결 해제'
// → 확인 모달 '카카오 연결을 해제할까요?' · '켜 둔 연습 알림도 꺼져요' · [취소] [해제하기] → 2.13, 카카오 회원은 '연결됨'만,
// 연결하고 돌아오면 '연결이 완료되었어요' [확인] 안내 모달, 오류는 서버 문구 토스트)
// · WAI-ARIA 대화 상자 패턴(열리면 포커스, Esc로 닫힘, 닫으면 포커스를 돌려줌)
// 모션은 끄고 본다. 끝나지 않는 서버 액션(외부 화면 이동 · 처리 중)은 테스트가 끝날 때 푼다.

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
const LINKED_MEMBER = { ...EMAIL_MEMBER, linkedProvider: "KAKAO" } satisfies MeResponse;
const KAKAO_MEMBER = {
  ...EMAIL_MEMBER,
  email: "a@kakao.com",
  socialProvider: "KAKAO",
} satisfies MeResponse;

const releases: (() => void)[] = [];
function pending<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (release = resolve));
  releases.push(() => release({} as T));
  return promise;
}

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  useToastStore.setState({ toast: null });
});

afterEach(async () => {
  await act(async () => releases.splice(0).forEach((release) => release()));
  cleanup();
  vi.resetAllMocks();
  MotionGlobalConfig.skipAnimations = false;
});

function renderRow(me: MeResponse, linked = false) {
  return render(
    <>
      <KakaoRow me={me} linked={linked} />
      <Toast />
    </>,
  );
}

/** 퇴장 모션(모션을 꺼도 다음 프레임에 끝난다)까지 흘려보낸다 */
async function flushFrames() {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

const linkButton = () => screen.getByRole("button", { name: /카카오\s*연결하기/ });
const unlinkButton = () => screen.getByRole("button", { name: "연결 해제" });
const confirmDialog = () => screen.queryByRole("dialog", { name: "카카오 연결을 해제할까요?" });
/** 모달 바깥(dim) */
const dim = () => confirmDialog()!.parentElement!;

describe("카카오로 가입한 회원(socialProvider KAKAO)", () => {
  it("'연결됨'만 보이고 누를 것이 없다(해제 없음)", () => {
    renderRow(KAKAO_MEMBER);

    expect(screen.getByText("연결됨")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("연결하지 않은 이메일 회원", () => {
  it("'연결하기' 줄을 누르면 카카오 동의를 시작하고, 넘어가는 동안 다시 누를 수 없다", async () => {
    startKakaoLink.mockReturnValue(pending());
    renderRow(EMAIL_MEMBER);
    // 처음 그릴 때는 포커스를 가져가지 않는다(해제한 뒤에만 이 줄로 준다)
    expect(document.activeElement).toBe(document.body);

    await act(async () => fireEvent.click(linkButton()));

    expect(startKakaoLink).toHaveBeenCalledOnce();
    expect((linkButton() as HTMLButtonElement).disabled).toBe(true);
    expect(linkButton().getAttribute("aria-busy")).toBe("true");
  });

  it("시작하지 못하면 서버 문구를 토스트로 보이고 다시 누를 수 있다", async () => {
    startKakaoLink.mockResolvedValue({
      error: "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    renderRow(EMAIL_MEMBER);

    await act(async () => fireEvent.click(linkButton()));

    expect(screen.getByRole("status").textContent).toBe(
      "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    expect((linkButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("카카오 화면에서 뒤로 가기로 되살아나면(bfcache) 다시 누를 수 있다", async () => {
    startKakaoLink.mockReturnValue(pending());
    renderRow(EMAIL_MEMBER);
    await act(async () => fireEvent.click(linkButton()));

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect((linkButton() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect((linkButton() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("연결한 이메일 회원(linkedProvider KAKAO)", () => {
  it("'연결됨' 옆 [연결 해제]를 누르면 확인 모달이 열리고 [취소]에 포커스가 간다", () => {
    renderRow(LINKED_MEMBER);
    expect(screen.getByText("연결됨")).toBeTruthy();

    fireEvent.click(unlinkButton());

    const dialog = confirmDialog()!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("켜 둔 연습 알림도 꺼져요");
    expect(screen.getByRole("dialog", { description: "켜 둔 연습 알림도 꺼져요" })).toBe(dialog);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "취소" }));
    expect(unlinkKakao).not.toHaveBeenCalled();
  });

  it.each([
    ["[취소]", () => fireEvent.click(screen.getByRole("button", { name: "취소" }))],
    ["Esc", () => fireEvent.keyDown(confirmDialog()!, { key: "Escape" })],
    ["dim(모달 바깥)", () => fireEvent.mouseDown(dim())],
  ])("%s로 닫으면 해제하지 않고 [연결 해제]로 포커스를 돌려준다", async (_, close) => {
    renderRow(LINKED_MEMBER);
    fireEvent.click(unlinkButton());

    close();

    await waitFor(() => expect(confirmDialog()).toBeNull());
    expect(document.activeElement).toBe(unlinkButton());
    expect(unlinkKakao).not.toHaveBeenCalled();
  });

  it("모달 안을 눌러도 닫히지 않는다", async () => {
    renderRow(LINKED_MEMBER);
    fireEvent.click(unlinkButton());

    fireEvent.mouseDown(confirmDialog()!);
    await flushFrames();

    expect(confirmDialog()).toBeTruthy();
  });

  it("Tab은 모달 안에서만 돈다([해제하기] → [취소], [취소]에서 Shift+Tab → [해제하기])", () => {
    renderRow(LINKED_MEMBER);
    fireEvent.click(unlinkButton());
    const cancel = screen.getByRole("button", { name: "취소" });
    const confirm = screen.getByRole("button", { name: "해제하기" });

    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("[해제하기]를 누르면 2.13을 부르고, 처리하는 동안 다시 누르거나 Esc · dim · [취소]로 닫을 수 없다", async () => {
    unlinkKakao.mockReturnValue(pending());
    renderRow(LINKED_MEMBER);
    fireEvent.click(unlinkButton());

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "해제하기" })));
    fireEvent.keyDown(confirmDialog()!, { key: "Escape" });
    fireEvent.mouseDown(dim());
    // 닫혔다면 사라지는 모션까지 끝난 뒤에 본다
    await flushFrames();

    expect(unlinkKakao).toHaveBeenCalledOnce();
    expect(confirmDialog()).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "해제하기" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "취소" }) as HTMLButtonElement).disabled).toBe(true);
    // 버튼이 모두 비활성이라 포커스를 모달에 두고, Tab이 모달 밖으로 나가지 않게 막는다
    expect(document.activeElement).toBe(confirmDialog());
    expect(fireEvent.keyDown(confirmDialog()!, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(confirmDialog());
  });

  it("해제에 실패하면 모달을 닫고 서버 문구를 토스트로 보이며 [연결 해제]로 포커스를 돌려준다", async () => {
    unlinkKakao.mockResolvedValue({ error: "잠시 후 다시 시도해 주세요." });
    renderRow(LINKED_MEMBER);
    fireEvent.click(unlinkButton());

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "해제하기" })));

    await waitFor(() => expect(confirmDialog()).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("잠시 후 다시 시도해 주세요.");
    expect(document.activeElement).toBe(unlinkButton());
  });

  it("해제하면 모달을 닫고, 줄이 '연결하기'로 바뀌면 그 줄로 포커스를 준다", async () => {
    unlinkKakao.mockResolvedValue({});
    const { rerender } = renderRow(LINKED_MEMBER);
    fireEvent.click(unlinkButton());

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "해제하기" })));
    await waitFor(() => expect(confirmDialog()).toBeNull());
    // 서버 액션의 refresh로 2.1이 다시 내려온다
    rerender(
      <>
        <KakaoRow me={EMAIL_MEMBER} />
        <Toast />
      </>,
    );

    expect(document.activeElement).toBe(linkButton());
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("연결 완료 안내(linked)", () => {
  it("연결하고 돌아오면 '연결이 완료되었어요' 모달을 띄우고 [확인]에 포커스, 완료 표시 쿠키를 지운다", async () => {
    await act(async () => {
      renderRow(LINKED_MEMBER, true);
    });

    const dialog = screen.getByRole("dialog", { name: "연결이 완료되었어요" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "확인" }));
    expect(dismissNotice).toHaveBeenCalledOnce();
  });

  it.each([
    ["[확인]", () => fireEvent.click(screen.getByRole("button", { name: "확인" }))],
    [
      "Esc",
      () =>
        fireEvent.keyDown(screen.getByRole("dialog", { name: "연결이 완료되었어요" }), {
          key: "Escape",
        }),
    ],
  ])("%s로 닫으면 '연결됨' 줄의 [연결 해제]로 포커스를 준다", async (_, close) => {
    await act(async () => {
      renderRow(LINKED_MEMBER, true);
    });

    close();

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "연결이 완료되었어요" })).toBeNull(),
    );
    expect(document.activeElement).toBe(unlinkButton());
  });

  it("연결하고 돌아온 게 아니면 안내도 없고 쿠키도 지우지 않으며, 포커스도 가져가지 않는다", () => {
    renderRow(LINKED_MEMBER);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(dismissNotice).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
});
