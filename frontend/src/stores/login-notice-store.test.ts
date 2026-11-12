// @vitest-environment node
// 기준: S01 로그인 버튼 위 오류 문구(같은 문구가 다시 와도 다시 보이도록 띄울 때마다 새 id)
import { beforeEach, describe, expect, it } from "vitest";

import { useLoginNoticeStore } from "./login-notice-store";

beforeEach(() => {
  useLoginNoticeStore.setState({ notice: null });
});

describe("useLoginNoticeStore · 로그인 오류 문구", () => {
  describe("상태 변화", () => {
    it("같은 문구를 다시 띄워도 새 id를 준다", () => {
      const { show } = useLoginNoticeStore.getState();

      show("이메일 또는 비밀번호가 맞지 않아요.");
      const first = useLoginNoticeStore.getState().notice?.id;
      show("이메일 또는 비밀번호가 맞지 않아요.");
      const second = useLoginNoticeStore.getState().notice?.id;

      expect(second).not.toBe(first);
    });
  });
});
