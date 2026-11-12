// @vitest-environment node
// 기준: 사용자 요청(2026-10-21: 이전 화면(S05 장치 점검)부터 받기, 2026-10-22: 다 받을 때까지 준비 줄에 진행률, 실패 상태에 따라 자동 재시도)
// · Figma S05(18:2333) · 사용자 결정(2026-10-26: 배경 그림도 미리 받는다. 배경을 못 받아도 면접은 막지 않는다)
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewerPreloadStore } from "@/stores/interviewer-preload-store";
import { deferred } from "@/test/deferred";

import { preloadInterviewer } from "./preload";

// 경계 mock: 모델 받기 · 해석(three.js)과 배경 그림 받기. 진행 소식과 끝나는 때는 테스트가 정한다
const scene = vi.hoisted(() => ({ preloadInterviewerAssets: vi.fn() }));
vi.mock("./scene", () => scene);
const backdrop = vi.hoisted(() => ({ preloadBackdrop: vi.fn() }));
vi.mock("./backdrop", () => backdrop);

const state = () => useInterviewerPreloadStore.getState();

/** 모델 받기를 테스트가 끝내게 하고, 진행 소식을 넣는 함수를 돌려준다 */
function pendingModel() {
  const load = deferred();
  let onProgress: ((ratio: number) => void) | undefined;
  scene.preloadInterviewerAssets.mockImplementation((_model, progress: (ratio: number) => void) => {
    onProgress = progress;
    return load.promise;
  });
  return { ...load, progress: (ratio: number) => onProgress!(ratio) };
}

/** 동적 import(./scene · ./backdrop)를 마치고, 이어진 Promise 처리(저장소 반영)를 가짜 시계 한 번으로 모두 돌린다 */
async function settle() {
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  useInterviewerPreloadStore.setState({ persona: null, status: "idle", progress: 0 });
  scene.preloadInterviewerAssets.mockResolvedValue(undefined);
  backdrop.preloadBackdrop.mockResolvedValue(undefined);
});

describe("preloadInterviewer · 면접관 모델 미리 받기", () => {
  describe("정상 처리", () => {
    it("받는 동안 진행률을 저장하고 다 받으면 ready가 된다", async () => {
      const model = pendingModel();
      preloadInterviewer("DEVIL");
      await settle();

      model.progress(0.42);
      expect(state()).toMatchObject({ persona: "DEVIL", status: "loading", progress: 0.42 });

      model.resolve();
      await settle();
      expect(state().status).toBe("ready");
    });

    it("배경 그림이 없는 면접관은 배경을 받지 않는다", async () => {
      preloadInterviewer("DEVIL");
      await settle();

      expect(state().status).toBe("ready");
      expect(backdrop.preloadBackdrop).not.toHaveBeenCalled();
    });
  });

  describe("상태 변화", () => {
    it("실패했던 면접관을 다시 부르면 처음부터 다시 받는다", async () => {
      useInterviewerPreloadStore.setState({ persona: "DEVIL", status: "failed", progress: 0.3 });

      preloadInterviewer("DEVIL");

      expect(state().status).toBe("loading");
      await settle();
      expect(scene.preloadInterviewerAssets).toHaveBeenCalledTimes(1);
      expect(state().status).toBe("ready");
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "받는 중", status: "loading" as const },
      { label: "다 받음", status: "ready" as const },
    ])("같은 면접관을 '$label'이면 다시 받지 않는다", async ({ status }) => {
      useInterviewerPreloadStore.setState({ persona: "DEVIL", status, progress: 0.5 });

      preloadInterviewer("DEVIL");
      await settle();

      expect(state()).toMatchObject({ persona: "DEVIL", status, progress: 0.5 });
      expect(scene.preloadInterviewerAssets).not.toHaveBeenCalled();
    });

    it("다른 면접관을 받는 중이면 새 면접관을 처음부터 받는다", async () => {
      useInterviewerPreloadStore.setState({ persona: "DUCK", status: "loading", progress: 0.5 });

      preloadInterviewer("DEVIL");
      await settle();

      expect(scene.preloadInterviewerAssets).toHaveBeenCalledTimes(1);
      expect(state()).toMatchObject({ persona: "DEVIL", status: "ready" });
    });
  });

  describe("경계값", () => {
    it("진행률은 1% 이상 바뀔 때만 저장한다", async () => {
      const model = pendingModel();
      preloadInterviewer("DEVIL");
      await settle();

      model.progress(0.0099);
      expect(state().progress).toBe(0);
      model.progress(0.01);
      expect(state().progress).toBe(0.01);

      model.resolve();
      await settle();
    });

    it("1% 미만으로 바뀌어도 다 받은 순간은 저장한다", async () => {
      const model = pendingModel();
      preloadInterviewer("DEVIL");
      await settle();
      model.progress(0.995);

      model.progress(1);

      expect(state()).toMatchObject({ status: "loading", progress: 1 });
      model.resolve();
      await settle();
    });
  });

  describe("오류 처리", () => {
    it("모델을 받지 못하면 failed가 된다", async () => {
      scene.preloadInterviewerAssets.mockRejectedValue(new Error("404"));

      preloadInterviewer("DEVIL");
      await settle();

      expect(state().status).toBe("failed");
    });

    it("배경 그림을 받지 못해도 모델을 다 받으면 ready가 된다", async () => {
      backdrop.preloadBackdrop.mockRejectedValue(new Error("404"));

      preloadInterviewer("COFFEE_CHAT");
      await settle();

      expect(state().status).toBe("ready");
      expect(backdrop.preloadBackdrop).toHaveBeenCalledTimes(1);
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("배경 그림이 있는 면접관은 모델과 배경을 다 받아야 ready가 된다", async () => {
      const background = deferred();
      backdrop.preloadBackdrop.mockReturnValue(background.promise);
      const model = pendingModel();
      preloadInterviewer("COFFEE_CHAT");
      await settle();

      model.resolve();
      await settle();
      expect(state().status).toBe("loading");

      background.resolve();
      await settle();
      expect(state().status).toBe("ready");
    });
  });
});
