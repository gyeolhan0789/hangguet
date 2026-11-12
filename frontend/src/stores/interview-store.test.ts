// 기준: 기획 메모 S06-E · 웹 Swagger leveledUp(5.8 응답에만 값이 있어 화면이 기억한다) · 모션 메모 S06-B
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "./interview-store";

// 경계 mock: 감탄 시각(performance.now)은 테스트마다 spy로 고정한다. sessionStorage는 jsdom 것을 쓴다

// 예시 데이터: 저장 키(소스의 persist name)
const STORAGE_KEY = "hankkeut:interview";

const INITIAL = {
  endOpen: false,
  answeredQuestionId: null,
  submittedSeq: null,
  confirmingSave: false,
  leveledUp: null,
  collapsed: false,
  uiHidden: false,
  exclaimedAt: null,
};

const CHANGED = {
  endOpen: true,
  answeredQuestionId: 303,
  submittedSeq: 3,
  confirmingSave: true,
  leveledUp: true,
  collapsed: true,
  uiHidden: true,
  exclaimedAt: 1234,
};

beforeEach(() => {
  useInterviewStore.getState().reset();
  sessionStorage.clear();
});

describe("useInterviewStore · 면접 화면 상태", () => {
  describe("상태 변화", () => {
    it.each([
      { action: "toggleCollapsed", field: "collapsed" },
      { action: "toggleUiHidden", field: "uiHidden" },
    ] as const)("'$action'을 부를 때마다 '$field'를 뒤집는다", ({ action, field }) => {
      useInterviewStore.getState()[action]();
      expect(useInterviewStore.getState()[field]).toBe(true);

      useInterviewStore.getState()[action]();
      expect(useInterviewStore.getState()[field]).toBe(false);
    });

    it("감탄하면 지금 시각을 기록한다", () => {
      vi.spyOn(performance, "now").mockReturnValue(1234);

      useInterviewStore.getState().exclaim();

      expect(useInterviewStore.getState().exclaimedAt).toBe(1234);
    });

    it("reset은 모든 값을 처음으로 되돌린다", () => {
      useInterviewStore.setState(CHANGED);

      useInterviewStore.getState().reset();

      expect(useInterviewStore.getState()).toMatchObject(INITIAL);
    });

    it("keepLeveledUp으로 reset하면 레벨업만 남긴다", () => {
      useInterviewStore.setState(CHANGED);

      useInterviewStore.getState().reset({ keepLeveledUp: true });

      expect(useInterviewStore.getState()).toMatchObject({ ...INITIAL, leveledUp: true });
    });

    it("레벨업만 sessionStorage에 남기고 모달 · 답한 질문 · 접기 · 화면 숨기기는 남기지 않는다", () => {
      useInterviewStore.setState(CHANGED);

      expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null").state).toEqual({
        leveledUp: true,
      });
    });
  });
});
