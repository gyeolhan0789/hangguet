// 기준: 기획 메모 S01-3(423:2140: 카카오 로그인 · 가입 오류는 모달을 닫고 S01 로그인 버튼 위 오류 문구 자리에)
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dismissNotice } from "@/lib/auth/social-actions";
import { useLoginNoticeStore } from "@/stores/login-notice-store";

import { LoginNotice } from "./login-notice";

// 경계 mock: 서버 액션(문구 쿠키 지우기). 문구 store는 실제로 쓴다
vi.mock("@/lib/auth/social-actions", () => ({ dismissNotice: vi.fn() }));

beforeEach(() => {
  useLoginNoticeStore.setState({ notice: null });
});

const TEXT = "가입 시간이 지났어요. 다시 로그인해 주세요.";

describe("LoginNotice · 카카오 실패 문구 넘기기", () => {
  describe("화면 표시", () => {
    it("받은 문구를 오류 문구 자리에 넘기고 문구 쿠키를 지운다", () => {
      render(<LoginNotice text={TEXT} />);

      expect(useLoginNoticeStore.getState().notice?.text).toBe(TEXT);
      expect(dismissNotice).toHaveBeenCalledTimes(1);
    });
  });

  describe("상태 변화", () => {
    it("쿠키를 지워 사라져도 넘긴 문구는 남는다", () => {
      const { unmount } = render(<LoginNotice text={TEXT} />);

      unmount();

      expect(useLoginNoticeStore.getState().notice?.text).toBe(TEXT);
    });
  });
});
