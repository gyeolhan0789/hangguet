// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 기준: 사용자 요청(2026-10-21: S05 장치 점검부터 면접관 모델을 미리 불러오기)
// WebGL로 그리는 부분은 jsdom · node에서 돌릴 수 없어, 미리 불러오기(내려받기 · 해석)만 본다. 그리기는 E2E가 본다.

const loadAsync = vi.fn();
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setMeshoptDecoder() {
      return this;
    }
    loadAsync(url: string) {
      return loadAsync(url);
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  vi.clearAllMocks();
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
    expect(loadAsync).toHaveBeenCalledWith(MODEL.glb);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      MODEL.faceRules,
      MODEL.animation,
    ]);
  });

  it("미리 불러오다 실패하면 지워, 다음에 다시 불러온다", async () => {
    loadAsync.mockRejectedValueOnce(new Error("network"));
    loadAsync.mockResolvedValue({ scene: {}, animations: [] });
    const { preloadInterviewerAssets } = await import("./scene");

    preloadInterviewerAssets(MODEL);
    expect(loadAsync).toHaveBeenCalledTimes(1);
    // 실패 처리(목록에서 지우기)가 끝나는 때를 순서로 짐작하지 않고, 다시 부르면 새로 불러올 때까지 확인한다.
    await vi.waitFor(() => {
      preloadInterviewerAssets(MODEL);
      expect(loadAsync).toHaveBeenCalledTimes(2);
    });
  });
});
