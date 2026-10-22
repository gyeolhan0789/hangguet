// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 기준: 사용자 요청(2026-10-21: S05 장치 점검부터 면접관 모델을 미리 불러오기)
// · 사용자 결정(2026-10-22: 실패 상태에 따라 다시 받기 — 재시도 규칙 자체는 retry.test.ts가 본다)
// WebGL로 그리는 부분은 jsdom · node에서 돌릴 수 없어, 미리 불러오기(내려받기 · 해석)만 본다. 그리기는 E2E가 본다.

const loadAsync = vi.fn();
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setMeshoptDecoder() {
      return this;
    }
    loadAsync(url: string, onProgress?: (event: { loaded: number; total: number }) => void) {
      return loadAsync(url, onProgress);
    }
  },
}));
vi.mock("three/addons/libs/meshopt_decoder.module.js", () => ({ MeshoptDecoder: {} }));

const MODEL = {
  glb: "/interview/devil/interviewer.glb",
  faceRules: "/interview/devil/face-rules.json",
  animation: "/interview/devil/animation.json",
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("preloadInterviewerAssets (면접관 모델 미리 불러오기)", () => {
  it("모델 · 표정 규칙 · 자세 구간을 내려받고, 같은 모델을 다시 부르면 또 받지 않는다", async () => {
    loadAsync.mockResolvedValue({ scene: {}, animations: [] });
    const { preloadInterviewerAssets } = await import("./scene");

    preloadInterviewerAssets(MODEL);
    preloadInterviewerAssets(MODEL);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    expect(loadAsync).toHaveBeenCalledTimes(1);
    expect(loadAsync).toHaveBeenCalledWith(MODEL.glb, expect.any(Function));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      MODEL.faceRules,
      MODEL.animation,
    ]);
  });

  it("받은 비율을 알려 주고, 다 받으면 끝난다", async () => {
    loadAsync.mockImplementation(async (_url, onProgress) => {
      onProgress({ loaded: 0, total: 0 });
      onProgress({ loaded: 25, total: 100 });
      onProgress({ loaded: 100, total: 100 });
      return { scene: {}, animations: [] };
    });
    const { preloadInterviewerAssets } = await import("./scene");
    const progress = vi.fn();

    await expect(preloadInterviewerAssets(MODEL, progress)).resolves.toBeUndefined();

    // 전체 크기를 모르면(total 0) 알리지 않는다.
    expect(progress.mock.calls).toEqual([[0.25], [1]]);
  });

  it("404는 다시 받지 않고 바로 실패하며, 목록에서 지워 다음에 처음부터 다시 받는다", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      url === MODEL.faceRules ? new Response("", { status: 404 }) : new Response("{}"),
    );
    loadAsync.mockResolvedValue({ scene: {}, animations: [] });
    const { preloadInterviewerAssets } = await import("./scene");

    await expect(preloadInterviewerAssets(MODEL)).rejects.toMatchObject({ status: 404 });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === MODEL.faceRules)).toHaveLength(1);

    vi.mocked(fetch).mockImplementation(async () => new Response("{}"));
    await expect(preloadInterviewerAssets(MODEL)).resolves.toBeUndefined();
    expect(loadAsync).toHaveBeenCalledTimes(2);
  });

  it("연결이 끊겨 실패하면(TypeError) 간격을 두고 다시 받는다", async () => {
    vi.useFakeTimers();
    loadAsync.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    loadAsync.mockResolvedValue({ scene: {}, animations: [] });
    const { preloadInterviewerAssets } = await import("./scene");

    const done = preloadInterviewerAssets(MODEL);
    await vi.advanceTimersByTimeAsync(0);
    expect(loadAsync).toHaveBeenCalledTimes(1);
    // 첫 재시도 간격은 1초 + 무작위(최대 1초)라 2초를 넘기면 반드시 다시 받는다.
    await vi.advanceTimersByTimeAsync(2000);

    await expect(done).resolves.toBeUndefined();
    expect(loadAsync).toHaveBeenCalledTimes(2);
  });
});
