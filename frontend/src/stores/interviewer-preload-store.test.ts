// @vitest-environment node
// 기준: 사용자 결정(2026-10-22: 모델을 다 받을 때까지 진행률을 띄우고 [면접 시작]을 막는다, 실패는 '면접 준비에 실패했어요')
import { beforeEach, describe, expect, it } from "vitest";

import { useInterviewerPreloadStore } from "./interviewer-preload-store";

// 경계 mock: 없음(store를 직접 부른다)

beforeEach(() => {
  useInterviewerPreloadStore.setState({ persona: null, status: "idle", progress: 0 });
});

describe("useInterviewerPreloadStore · 면접관 모델 받기 상태", () => {
  describe("상태 변화", () => {
    it("받는 중인 면접관의 진행률 소식이면 진행률을 바꾼다", () => {
      useInterviewerPreloadStore.getState().start("DUCK");

      useInterviewerPreloadStore.getState().setProgress("DUCK", 0.4);

      expect(useInterviewerPreloadStore.getState()).toMatchObject({
        persona: "DUCK",
        status: "loading",
        progress: 0.4,
      });
    });

    it("다른 면접관의 진행률 소식은 버린다", () => {
      useInterviewerPreloadStore.getState().start("DUCK");

      useInterviewerPreloadStore.getState().setProgress("DEVIL", 0.4);

      expect(useInterviewerPreloadStore.getState().progress).toBe(0);
    });

    it("받기가 끝난 뒤 온 진행률 소식은 버린다", () => {
      useInterviewerPreloadStore.getState().start("DUCK");
      useInterviewerPreloadStore.getState().finish("DUCK", "ready");

      useInterviewerPreloadStore.getState().setProgress("DUCK", 0.4);

      expect(useInterviewerPreloadStore.getState().progress).toBe(1);
    });

    it("다 받으면 진행률을 1로 채운다", () => {
      useInterviewerPreloadStore.getState().start("DUCK");
      useInterviewerPreloadStore.getState().setProgress("DUCK", 0.4);

      useInterviewerPreloadStore.getState().finish("DUCK", "ready");

      expect(useInterviewerPreloadStore.getState()).toMatchObject({ status: "ready", progress: 1 });
    });

    it("실패하면 진행률을 그대로 둔다", () => {
      useInterviewerPreloadStore.getState().start("DUCK");
      useInterviewerPreloadStore.getState().setProgress("DUCK", 0.4);

      useInterviewerPreloadStore.getState().finish("DUCK", "failed");

      expect(useInterviewerPreloadStore.getState()).toMatchObject({
        status: "failed",
        progress: 0.4,
      });
    });

    it("다른 면접관의 끝 소식은 버린다", () => {
      useInterviewerPreloadStore.getState().start("DUCK");

      useInterviewerPreloadStore.getState().finish("DEVIL", "ready");

      expect(useInterviewerPreloadStore.getState()).toMatchObject({
        persona: "DUCK",
        status: "loading",
        progress: 0,
      });
    });
  });
});
