import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewerPreloadStore } from "@/stores/interviewer-preload-store";

import { interviewerLook } from "./models";
import { preloadInterviewer } from "./preload";

// 기준: 사용자 결정(2026-10-22: S05에서 면접관 모델을 다 받을 때까지 준비 줄에 진행률을 띄우고, 실패하면 '면접 준비에 실패했어요')
// · 사용자 결정(2026-10-26: 커피챗 면접관도 3D 모델을 쓴다)
// 내려받기 · 해석(three.js)은 scene.test.ts가 보고, 여기서는 그 결과를 저장소 상태로 옮기는 일만 본다.

type Progress = (ratio: number) => void;
const preloadInterviewerAssets = vi.fn<(model: unknown, onProgress: Progress) => Promise<void>>();
vi.mock("./scene", () => ({
  preloadInterviewerAssets: (model: unknown, onProgress: Progress) =>
    preloadInterviewerAssets(model, onProgress),
}));

// 지금은 모든 면접관에 모델이 있어, 모델이 없는 면접관은 테스트에서 interviewerLook이 null을 돌려주게 해 본다.
vi.mock("./models", async (importOriginal) => {
  const models = await importOriginal<typeof import("./models")>();
  return { ...models, interviewerLook: vi.fn(models.interviewerLook) };
});

const state = () => useInterviewerPreloadStore.getState();

/** 끝나는 때를 테스트가 정하는 받기 */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  let onProgress!: Progress;
  preloadInterviewerAssets.mockImplementationOnce((_model, progress) => {
    onProgress = progress;
    return promise;
  });
  return { resolve, reject, progress: (ratio: number) => onProgress(ratio) };
}

beforeEach(() => {
  useInterviewerPreloadStore.setState({ persona: null, status: "idle", progress: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
  // 모델이 없는 면접관으로 바꾼 값을 다음 테스트로 넘기지 않는다(실제 interviewerLook으로 되돌린다).
  vi.mocked(interviewerLook).mockReset();
});

describe("preloadInterviewer", () => {
  it("받는 동안 진행률을 1% 단위로 옮기고, 다 받으면 ready", async () => {
    const load = deferred();
    preloadInterviewer("DEVIL");
    expect(state()).toMatchObject({ persona: "DEVIL", status: "loading", progress: 0 });

    await vi.waitFor(() => expect(preloadInterviewerAssets).toHaveBeenCalledTimes(1));
    load.progress(0.005);
    expect(state().progress).toBe(0);
    load.progress(0.42);
    expect(state().progress).toBe(0.42);

    load.resolve();
    await vi.waitFor(() => expect(state().status).toBe("ready"));
    expect(state().progress).toBe(1);
  });

  it("다시 해도 안 되면 failed, 다시 부르면 처음부터 다시 받는다", async () => {
    const first = deferred();
    preloadInterviewer("DEVIL");
    first.reject(new Error("404"));
    await vi.waitFor(() => expect(state().status).toBe("failed"));

    const second = deferred();
    preloadInterviewer("DEVIL");
    expect(state().status).toBe("loading");
    second.resolve();
    await vi.waitFor(() => expect(state().status).toBe("ready"));
    expect(preloadInterviewerAssets).toHaveBeenCalledTimes(2);
  });

  it("같은 면접관을 받는 중이거나 다 받았으면 다시 받지 않는다", async () => {
    const load = deferred();
    preloadInterviewer("DEVIL");
    preloadInterviewer("DEVIL");
    load.resolve();
    await vi.waitFor(() => expect(state().status).toBe("ready"));
    preloadInterviewer("DEVIL");

    expect(preloadInterviewerAssets).toHaveBeenCalledTimes(1);
  });

  it("커피챗 면접관도 자기 3D 모델을 받는다", async () => {
    const load = deferred();
    preloadInterviewer("COFFEE_CHAT");
    expect(state()).toMatchObject({ persona: "COFFEE_CHAT", status: "loading" });

    await vi.waitFor(() =>
      expect(preloadInterviewerAssets).toHaveBeenCalledWith(
        expect.objectContaining({ glb: "/interview/coffee-chat/interviewer.glb" }),
        expect.any(Function),
      ),
    );
    load.resolve();
    await vi.waitFor(() => expect(state().status).toBe("ready"));
  });

  it("3D 모델이 없는 면접관은 받을 것이 없어 바로 ready", () => {
    vi.mocked(interviewerLook).mockReturnValueOnce(null);
    preloadInterviewer("COFFEE_CHAT");

    expect(interviewerLook).toHaveBeenCalledWith("COFFEE_CHAT");
    expect(state()).toMatchObject({ persona: "COFFEE_CHAT", status: "ready", progress: 1 });
    expect(preloadInterviewerAssets).not.toHaveBeenCalled();
  });

  it("다른 면접관으로 바뀐 뒤 늦게 온 결과는 버린다", async () => {
    const devil = deferred();
    preloadInterviewer("DEVIL");
    await vi.waitFor(() => expect(preloadInterviewerAssets).toHaveBeenCalledTimes(1));
    const coffee = deferred();
    preloadInterviewer("COFFEE_CHAT");
    await vi.waitFor(() => expect(preloadInterviewerAssets).toHaveBeenCalledTimes(2));

    devil.progress(0.5);
    devil.reject(new Error("late"));
    // 남은 마이크로태스크(늦게 온 실패 처리)를 모두 끝낸 뒤 본다.
    await new Promise((done) => setTimeout(done, 0));
    expect(state()).toMatchObject({ persona: "COFFEE_CHAT", status: "loading", progress: 0 });

    coffee.resolve();
    await vi.waitFor(() => expect(state().status).toBe("ready"));
  });
});
