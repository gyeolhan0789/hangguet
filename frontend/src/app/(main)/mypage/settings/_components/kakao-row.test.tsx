// 기준: Figma S09-1 Row 카카오(436:2096: '카카오' · '연결하기') · S09-1-B(436:2104: '연결됨') · Swagger 2.1 MeResponse(socialProvider ·
// linkedProvider) · 2.12 소셜 계정 연결 · 2.13 연결 해제 · 기획 메모 S09-1 · S09-1-B(실패는 토스트) · 사용자 결정(연결하고 돌아오면 완료 안내 모달)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dismissNotice } from "@/lib/auth/social-actions";
import { startKakaoLink, unlinkKakao } from "@/lib/user/actions";
import { useToastStore } from "@/stores/toast-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import type { MeResponse } from "@/types/api";

import { KakaoRow } from "./kakao-row";

// 경계 mock: 서버 액션(2.12 시작 · 2.13 · 문구 쿠키 지우기)과 연출(motion)
vi.mock("@/lib/user/actions", () => ({ startKakaoLink: vi.fn(), unlinkKakao: vi.fn() }));
vi.mock("@/lib/auth/social-actions", () => ({ dismissNotice: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 2.1 200 예시(이메일 회원) · 2.12 연결 뒤(linkedProvider KAKAO) · 카카오 가입 회원
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
const LINKED_MEMBER: MeResponse = { ...EMAIL_MEMBER, linkedProvider: "KAKAO" };
const KAKAO_MEMBER: MeResponse = { ...EMAIL_MEMBER, email: "a@kakao.com", socialProvider: "KAKAO" };
const UNLINK_FAILED = "잠시 후 다시 시도해 주세요.";

const linkButton = () => screen.getByRole("button", { name: /연결하기/ });
const unlinkButton = () => screen.getByRole("button", { name: "연결 해제" });
const confirmDialog = () => screen.queryByRole("dialog", { name: "카카오 연결을 해제할까요?" });

/** 카카오 동의 화면에서 뒤로 가기로 페이지가 되살아난다(bfcache) */
function restoreFromBfcache() {
  act(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
}

beforeEach(() => {
  useToastStore.setState({ toast: null });
});

describe("KakaoRow · 설정 카카오 줄", () => {
  describe("카카오 가입 회원", () => {
    describe("화면 표시", () => {
      it("카카오로 가입한 회원은 '연결됨'만 보이고 누를 것이 없다", () => {
        render(<KakaoRow me={KAKAO_MEMBER} />);

        expect(screen.getByText("연결됨")).toBeDefined();
        expect(screen.queryAllByRole("button")).toHaveLength(0);
      });
    });
  });

  describe("계정 연결", () => {
    describe("화면 표시", () => {
      it("연결하지 않은 이메일 회원은 '연결하기' 줄을 보여 준다", () => {
        render(<KakaoRow me={EMAIL_MEMBER} />);

        expect(linkButton().textContent).toContain("카카오");
        expect(screen.queryByRole("button", { name: "연결 해제" })).toBeNull();
      });
    });

    describe("사용자 조작", () => {
      it("'연결하기'를 누르면 카카오 연결을 시작한다", async () => {
        vi.mocked(startKakaoLink).mockResolvedValue({});
        render(<KakaoRow me={EMAIL_MEMBER} />);

        fireEvent.click(linkButton());
        await flushPromises();

        expect(startKakaoLink).toHaveBeenCalledTimes(1);
      });
    });

    describe("오류 처리", () => {
      it("시작하지 못하면 서버 문구를 토스트로 보이고 다시 누를 수 있다", async () => {
        const unavailable = "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";
        vi.mocked(startKakaoLink).mockResolvedValue({ error: unavailable });
        render(<KakaoRow me={EMAIL_MEMBER} />);

        fireEvent.click(linkButton());
        await flushPromises();

        expect(useToastStore.getState().toast?.text).toBe(unavailable);
        expect(linkButton().hasAttribute("disabled")).toBe(false);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("넘어가는 동안에는 '연결하기'를 다시 누를 수 없다", async () => {
        const moving = deferred<{ error?: string }>();
        vi.mocked(startKakaoLink).mockReturnValue(moving.promise);
        render(<KakaoRow me={EMAIL_MEMBER} />);

        fireEvent.click(linkButton());
        fireEvent.click(linkButton());

        expect(linkButton().hasAttribute("disabled")).toBe(true);
        expect(startKakaoLink).toHaveBeenCalledTimes(1);
        await act(async () => moving.resolve({}));
      });

      it("카카오 화면에서 뒤로 가기로 되살아나면 '연결하기'를 다시 누를 수 있다", async () => {
        const moving = deferred<{ error?: string }>();
        vi.mocked(startKakaoLink).mockReturnValue(moving.promise);
        render(<KakaoRow me={EMAIL_MEMBER} />);
        fireEvent.click(linkButton());

        restoreFromBfcache();

        expect(linkButton().hasAttribute("disabled")).toBe(false);
        await act(async () => moving.resolve({}));
      });
    });

    describe("정리", () => {
      it("언마운트하면 되살아남 감지를 해제한다", () => {
        const add = vi.spyOn(window, "addEventListener");
        const remove = vi.spyOn(window, "removeEventListener");
        const { unmount } = render(<KakaoRow me={EMAIL_MEMBER} />);
        const onPageShow = add.mock.calls.find(([type]) => type === "pageshow")?.[1];

        unmount();

        expect(onPageShow).toBeDefined();
        expect(remove).toHaveBeenCalledWith("pageshow", onPageShow);
      });
    });
  });

  describe("연결 해제", () => {
    describe("화면 표시", () => {
      it("연결한 이메일 회원은 '연결됨' 옆에 [연결 해제]를 보여 준다", () => {
        render(<KakaoRow me={LINKED_MEMBER} />);

        expect(screen.getByText("연결됨")).toBeDefined();
        expect(unlinkButton()).toBeDefined();
        expect(screen.queryByRole("button", { name: /연결하기/ })).toBeNull();
      });
    });

    describe("사용자 조작", () => {
      it("[연결 해제]를 누르면 확인 모달을 열고 [취소]에 포커스를 준다", () => {
        render(<KakaoRow me={LINKED_MEMBER} />);

        fireEvent.click(unlinkButton());

        expect(confirmDialog()).not.toBeNull();
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "취소" }));
      });

      it("[취소]를 누르면 모달을 닫고 [연결 해제]로 포커스를 돌려준다", () => {
        render(<KakaoRow me={LINKED_MEMBER} />);
        fireEvent.click(unlinkButton());

        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        expect(confirmDialog()).toBeNull();
        expect(document.activeElement).toBe(unlinkButton());
      });

      it("해제되면 모달을 닫고 줄이 '연결하기'로 바뀌면 그 줄로 포커스를 준다", async () => {
        vi.mocked(unlinkKakao).mockResolvedValue({});
        const { rerender } = render(<KakaoRow me={LINKED_MEMBER} />);
        fireEvent.click(unlinkButton());

        fireEvent.click(screen.getByRole("button", { name: "해제하기" }));
        await flushPromises();
        rerender(<KakaoRow me={EMAIL_MEMBER} />);

        expect(confirmDialog()).toBeNull();
        expect(document.activeElement).toBe(linkButton());
      });
    });

    describe("오류 처리", () => {
      it("해제에 실패하면 모달을 닫고 서버 문구를 토스트로 보이며 [연결 해제]로 포커스를 돌려준다", async () => {
        vi.mocked(unlinkKakao).mockResolvedValue({ error: UNLINK_FAILED });
        render(<KakaoRow me={LINKED_MEMBER} />);
        fireEvent.click(unlinkButton());

        fireEvent.click(screen.getByRole("button", { name: "해제하기" }));
        await flushPromises();

        expect(confirmDialog()).toBeNull();
        expect(useToastStore.getState().toast?.text).toBe(UNLINK_FAILED);
        expect(document.activeElement).toBe(unlinkButton());
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("해제하는 동안에는 두 버튼을 누를 수 없다", async () => {
        const unlinking = deferred<{ error?: string }>();
        vi.mocked(unlinkKakao).mockReturnValue(unlinking.promise);
        render(<KakaoRow me={LINKED_MEMBER} />);
        fireEvent.click(unlinkButton());

        fireEvent.click(screen.getByRole("button", { name: "해제하기" }));

        expect(screen.getByRole("button", { name: "해제하기" }).hasAttribute("disabled")).toBe(
          true,
        );
        expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true);
        await act(async () => unlinking.resolve({}));
      });
    });
  });

  describe("연결 완료 안내", () => {
    describe("화면 표시", () => {
      it("연결하고 돌아오면 '연결이 완료되었어요' 모달을 띄우고 [확인]에 포커스를 준다", () => {
        render(<KakaoRow me={LINKED_MEMBER} linked />);

        expect(screen.getByRole("dialog", { name: "연결이 완료되었어요" })).toBeDefined();
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "확인" }));
      });

      it("연결하고 돌아온 게 아니면 안내를 띄우지 않고 완료 표시 쿠키도 지우지 않는다", () => {
        render(<KakaoRow me={LINKED_MEMBER} />);

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(dismissNotice).not.toHaveBeenCalled();
      });

      it("안내를 띄우면 새로 고쳐도 다시 뜨지 않게 완료 표시를 지운다", () => {
        render(<KakaoRow me={LINKED_MEMBER} linked />);

        expect(dismissNotice).toHaveBeenCalledTimes(1);
      });
    });

    describe("사용자 조작", () => {
      it("[확인]을 누르면 안내를 닫고 [연결 해제]로 포커스를 준다", () => {
        render(<KakaoRow me={LINKED_MEMBER} linked />);

        fireEvent.click(screen.getByRole("button", { name: "확인" }));

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(unlinkButton());
      });
    });
  });
});
