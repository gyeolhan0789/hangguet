// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 기준: 사용자 요청(2026-10-21: S05 장치 점검부터 면접관 모델을 미리 불러오기)
// · 사용자 결정(2026-10-22: 실패 상태에 따라 다시 받기 — 재시도 규칙 자체는 retry.test.ts가 본다)
// · 사용자 결정(2026-11-04: 진행률은 모델 원본 크기 기준, 받다가 멈추면 다시 받기 — 받기 자체는 download.test.ts가 본다)
// WebGL로 그리는 부분은 jsdom · node에서 돌릴 수 없어, 미리 불러오기(내려받기 · 해석)만 본다. 그리기는 E2E가 본다.

const parseAsync = vi.fn();
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setMeshoptDecoder() {
      return this;
    }
    parseAsync(data: ArrayBuffer, path: string) {
      return parseAsync(data, path);
    }
  },
}));
vi.mock("three/addons/libs/meshopt_decoder.module.js", () => ({ MeshoptDecoder: {} }));

const MODEL = {
  glb: "/interview/devil/interviewer.glb",
  glbBytes: 100,
  faceRules: "/interview/devil/face-rules.json",
  animation: "/interview/devil/animation.json",
};

/** 내용을 조각으로 나눠 보내는 응답(gzip 응답처럼 Content-Length 없이) */
const chunked = (...sizes: number[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of sizes) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    }),
  );

const fetchUrls = () => vi.mocked(fetch).mock.calls.map(([url]) => url);

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  parseAsync.mockResolvedValue({ scene: {}, animations: [] });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("preloadInterviewerAssets (면접관 모델 미리 불러오기)", () => {
  it("모델 · 표정 규칙 · 자세 구간을 내려받아 모델을 해석하고, 같은 모델을 다시 부르면 또 받지 않는다", async () => {
    const { preloadInterviewerAssets } = await import("./scene");

    preloadInterviewerAssets(MODEL);
    await expect(preloadInterviewerAssets(MODEL)).resolves.toBeUndefined();

    expect(fetchUrls()).toEqual([MODEL.glb, MODEL.faceRules, MODEL.animation]);
    // 모델 안의 다른 파일은 모델과 같은 폴더 기준으로 찾는다(GLTFLoader.load와 같음).
    expect(parseAsync).toHaveBeenCalledTimes(1);
    expect(parseAsync).toHaveBeenCalledWith(expect.any(ArrayBuffer), "/interview/devil/");
  });

  it("전체 크기를 알려 주지 않는 응답도 모델 원본 크기(glbBytes) 기준으로 받은 비율을 알린다", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      url === MODEL.glb ? chunked(25, 50, 25) : new Response("{}"),
    );
    const { preloadInterviewerAssets } = await import("./scene");
    const progress = vi.fn();

    await expect(preloadInterviewerAssets(MODEL, progress)).resolves.toBeUndefined();

    expect(progress.mock.calls).toEqual([[0.25], [0.75], [1]]);
  });

  it("받은 양이 원본 크기보다 커도 비율은 1을 넘지 않는다", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      url === MODEL.glb ? chunked(80, 40) : new Response("{}"),
    );
    const { preloadInterviewerAssets } = await import("./scene");
    const progress = vi.fn();

    await preloadInterviewerAssets(MODEL, progress);

    expect(progress.mock.calls).toEqual([[0.8], [1]]);
  });

  it("404는 다시 받지 않고 바로 실패하며, 목록에서 지워 다음에 처음부터 다시 받는다", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      url === MODEL.faceRules ? new Response("", { status: 404 }) : new Response("{}"),
    );
    const { preloadInterviewerAssets } = await import("./scene");

    await expect(preloadInterviewerAssets(MODEL)).rejects.toMatchObject({ status: 404 });
    expect(fetchUrls().filter((url) => url === MODEL.faceRules)).toHaveLength(1);

    vi.mocked(fetch).mockImplementation(async () => new Response("{}"));
    await expect(preloadInterviewerAssets(MODEL)).resolves.toBeUndefined();
    expect(fetchUrls().filter((url) => url === MODEL.glb)).toHaveLength(2);
  });

  it("연결이 끊겨 실패하면(TypeError) 간격을 두고 다시 받는다", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { preloadInterviewerAssets } = await import("./scene");

    const done = preloadInterviewerAssets(MODEL);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchUrls().filter((url) => url === MODEL.glb)).toHaveLength(1);
    // 첫 재시도 간격은 1초 + 무작위(최대 1초)라 2초를 넘기면 반드시 다시 받는다.
    await vi.advanceTimersByTimeAsync(2000);

    await expect(done).resolves.toBeUndefined();
    expect(fetchUrls().filter((url) => url === MODEL.glb)).toHaveLength(2);
  });

  it("받다가 멈추면(STALL_MS 동안 데이터 없음) 끊고 간격을 두고 다시 받는다", async () => {
    vi.useFakeTimers();
    const { STALL_MS } = await import("./download");
    // 첫 모델 받기: 응답은 오지만 내용이 끝나지 않는다. 끊으면(abort) 읽던 내용도 실패한다.
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const signal = init!.signal!;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(30));
            signal.addEventListener("abort", () => controller.error(signal.reason));
          },
        }),
      );
    });
    const { preloadInterviewerAssets } = await import("./scene");
    const progress = vi.fn();

    const done = preloadInterviewerAssets(MODEL, progress);
    await vi.advanceTimersByTimeAsync(STALL_MS - 1);
    expect(fetchUrls().filter((url) => url === MODEL.glb)).toHaveLength(1);
    expect(progress.mock.calls).toEqual([[0.3]]);

    await vi.advanceTimersByTimeAsync(1 + 2000);

    await expect(done).resolves.toBeUndefined();
    expect(fetchUrls().filter((url) => url === MODEL.glb)).toHaveLength(2);
  });
});
