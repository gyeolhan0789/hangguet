import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GazeSample } from "@/lib/interview/gaze";
import { useGazeStore } from "@/stores/gaze-store";

import { FRAME_WIDTH, FRAME_WINDOW_MS, GAZE_INTERVAL_MS, useGazeTracker } from "./use-gaze-tracker";

// 기준: API 명세 5.8 gazeRatio(화면이 면접 내내 브라우저에서 잰 값) · MediaPipe Face Landmarker 웹 가이드
// (FilesetResolver.forVisionTasks · FaceLandmarker.createFromOptions · runningMode VIDEO · detectForVideo,
// 영상 시각이 바뀐 프레임만 잰다)
// MediaPipe(WASM)와 브라우저 영상 재생, 결과를 시선으로 바꾸는 계산(gazeSample, gaze.test.ts에서 따로 본다)은 대역으로 둔다.

const SAMPLE: GazeSample = {
  headYaw: 1,
  headPitch: 2,
  eyeYaw: 0.1,
  eyePitch: 0.2,
  blinking: false,
};
const gazeSample = vi.fn<() => GazeSample | null>();
const blinkScore = vi.fn<() => number | null>();
vi.mock("@/lib/interview/gaze", () => ({
  gazeSample: () => gazeSample(),
  blinkScore: () => blinkScore(),
}));

const landmarker = { detectForVideo: vi.fn(), close: vi.fn() };
const createFromOptions = vi.fn();
const forVisionTasks = vi.fn();
vi.mock("@mediapipe/tasks-vision", () => ({
  FaceLandmarker: { createFromOptions: (...args: unknown[]) => createFromOptions(...args) },
  FilesetResolver: { forVisionTasks: (...args: unknown[]) => forVisionTasks(...args) },
}));

const camera = {} as MediaStreamTrack;
const stream = { getVideoTracks: () => [camera] } as unknown as MediaStream;

/** 영상 상태. 테스트가 바꾼다(jsdom에는 영상 재생이 없다) */
let readyState: number;
let videoTime: number;

/** 대역 모듈을 불러오고 MediaPipe 준비 · 영상 재생까지 끝낸다 */
const loaded = () => act(async () => vi.advanceTimersByTimeAsync(0));

/** 재는 간격만큼 n번 지난다. 영상은 매번 다음 프레임으로 넘어간다 */
async function tick(n: number, { advanceVideo = true } = {}) {
  for (let i = 0; i < n; i++) {
    if (advanceVideo) videoTime += GAZE_INTERVAL_MS / 1000;
    await act(async () => vi.advanceTimersByTimeAsync(GAZE_INTERVAL_MS));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(readonly tracks: MediaStreamTrack[]) {}
    },
  );
  readyState = HTMLMediaElement.HAVE_ENOUGH_DATA;
  videoTime = 0;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockImplementation(() => readyState);
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(() => videoTime);
  // 앞 테스트에서 바꾼 동작(인식 오류 등)이 남지 않게 매번 처음부터 정한다
  landmarker.detectForVideo.mockReset();
  landmarker.close.mockReset();
  forVisionTasks.mockReset().mockResolvedValue({});
  createFromOptions.mockReset().mockResolvedValue(landmarker);
  gazeSample.mockReset().mockReturnValue(SAMPLE);
  blinkScore.mockReset().mockReturnValue(0.1);
  useGazeStore.setState({ frames: [SAMPLE] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useGazeTracker (S06 화상 면접 시선 측정)", () => {
  it("면접 화면에 들어오면 지난 값을 비우고, 카메라 영상으로 정해진 간격마다 재서 쌓는다", async () => {
    renderHook(() => useGazeTracker(stream));
    expect(useGazeStore.getState().frames).toEqual([]);
    await loaded();

    expect(forVisionTasks).toHaveBeenCalledWith("/mediapipe/wasm");
    expect(createFromOptions).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate: "CPU" },
        runningMode: "VIDEO",
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      }),
    );
    await tick(3);

    expect(useGazeStore.getState().frames).toEqual([SAMPLE, SAMPLE, SAMPLE]);
    // VIDEO 모드는 넘기는 시각이 계속 늘어야 한다
    const times = landmarker.detectForVideo.mock.calls.map((call) => call[1] as number);
    expect(times).toHaveLength(3);
    expect(times[1]).toBeGreaterThan(times[0]);
    expect(times[2]).toBeGreaterThan(times[1]);
  });

  it("얼굴이 잡히지 않은 프레임은 안 본 것으로 세도록 비어 있는 값(null)으로 쌓는다", async () => {
    gazeSample.mockReturnValueOnce(null).mockReturnValue(SAMPLE);
    renderHook(() => useGazeTracker(stream));
    await loaded();
    await tick(2);

    expect(useGazeStore.getState().frames).toEqual([null, SAMPLE]);
  });

  it("영상이 멈춰 같은 프레임이거나 아직 준비되지 않았으면 재지 않는다", async () => {
    renderHook(() => useGazeTracker(stream));
    await loaded();
    // 처음 프레임만 재고, 영상이 멈춘 동안(시각이 그대로) 같은 프레임은 다시 재지 않는다
    await tick(3, { advanceVideo: false });
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);
    readyState = HTMLMediaElement.HAVE_METADATA;
    await tick(2);
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);

    readyState = HTMLMediaElement.HAVE_ENOUGH_DATA;
    await tick(1);
    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
  });

  it("화면을 떠나면 재기를 멈추고 MediaPipe를 닫는다", async () => {
    const { unmount } = renderHook(() => useGazeTracker(stream));
    await loaded();
    unmount();
    await tick(3);

    expect(landmarker.close).toHaveBeenCalledTimes(1);
    expect(landmarker.detectForVideo).not.toHaveBeenCalled();
  });

  it("MediaPipe를 불러오는 동안 화면을 떠나면, 다 불러온 뒤 닫고 재지 않는다", async () => {
    let finish!: (value: typeof landmarker) => void;
    createFromOptions.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { unmount } = renderHook(() => useGazeTracker(stream));
    await loaded();
    unmount();
    await act(async () => finish(landmarker));
    await tick(3);

    expect(landmarker.close).toHaveBeenCalledTimes(1);
    expect(landmarker.detectForVideo).not.toHaveBeenCalled();
  });

  it("영상 재생을 기다리는 동안 화면을 떠나면 재기를 시작하지 않는다", async () => {
    let play!: () => void;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(
      new Promise<void>((resolve) => (play = resolve)),
    );
    const { unmount } = renderHook(() => useGazeTracker(stream));
    await loaded();
    unmount();
    await act(async () => play());
    await tick(3);

    expect(landmarker.detectForVideo).not.toHaveBeenCalled();
  });

  it("카메라가 바뀌면 이전 인식기를 닫고 새로 만들며, 쌓인 값은 그대로 둔다", async () => {
    const { rerender } = renderHook(({ current }) => useGazeTracker(current), {
      initialProps: { current: stream },
    });
    await loaded();
    await tick(1);
    const next = { getVideoTracks: () => [{} as MediaStreamTrack] } as unknown as MediaStream;
    rerender({ current: next });
    await loaded();
    await tick(1);

    expect(landmarker.close).toHaveBeenCalledTimes(1);
    expect(createFromOptions).toHaveBeenCalledTimes(2);
    expect(useGazeStore.getState().frames).toEqual([SAMPLE, SAMPLE]);
  });

  it("MediaPipe를 불러오지 못하면 재지 않고 넘어간다(면접은 계속된다)", async () => {
    createFromOptions.mockRejectedValue(new Error("모델을 받지 못함"));
    renderHook(() => useGazeTracker(stream));
    await loaded();
    await tick(3);

    expect(useGazeStore.getState().frames).toEqual([]);
  });

  it("인식 중 오류가 나면 그때까지 잰 값만 남기고 멈춘다", async () => {
    landmarker.detectForVideo.mockReturnValueOnce({}).mockImplementation(() => {
      throw new Error("인식 실패");
    });
    renderHook(() => useGazeTracker(stream));
    await loaded();
    await tick(4);

    expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
    expect(useGazeStore.getState().frames).toEqual([SAMPLE]);
  });

  it("카메라가 없으면 MediaPipe를 불러오지 않는다", async () => {
    renderHook(() => useGazeTracker(null));
    await loaded();

    expect(forVisionTasks).not.toHaveBeenCalled();
  });
});

describe("useGazeTracker 인상 판단 사진 고르기(AI 명세 6.3 interview.frame)", () => {
  // 캔버스마다 마지막으로 찍은 프레임 번호. jsdom에는 캔버스 그리기가 없어 그린 내용 대신 번호로 따라간다
  const drawn = new WeakMap<object, number>();
  let frameNo: number;

  beforeEach(() => {
    // 1초 구간을 정확히 세도록 performance.now도 가짜 시계로 돌린다
    vi.useRealTimers();
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
    });
    frameNo = 0;
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1280);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(720);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return {
        canvas: this,
        drawImage(this: { canvas: HTMLCanvasElement }, source: object) {
          const frame = source instanceof HTMLVideoElement ? ++frameNo : drawn.get(source)!;
          drawn.set(this.canvas, frame);
        },
      } as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement["getContext"]);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(new Blob([String(drawn.get(this))], { type: "image/jpeg" }));
    });
  });

  /** 찍은 n번째 프레임을 잰 시각(detectForVideo에 넘긴 시각) */
  const detectedAt = (n: number) => landmarker.detectForVideo.mock.calls[n - 1][1] as number;

  it("찍은 캔버스를 재고, 1초마다 그동안 눈을 가장 크게 뜬 프레임을 640px 가로로 넘긴다", async () => {
    // 2번째 프레임(0.05)이 가장 눈을 크게 떴고, 얼굴이 없는 프레임(null)은 고르지 않는다
    blinkScore
      .mockReturnValueOnce(0.3)
      .mockReturnValueOnce(0.05)
      .mockReturnValueOnce(null)
      .mockReturnValue(0.6);
    const onFrame = vi.fn();
    renderHook(() => useGazeTracker(stream, onFrame));
    await loaded();
    await tick(FRAME_WINDOW_MS / GAZE_INTERVAL_MS);
    expect(onFrame).not.toHaveBeenCalled();
    await tick(1);

    expect(landmarker.detectForVideo.mock.calls[0][0]).toBeInstanceOf(HTMLCanvasElement);
    expect(onFrame).toHaveBeenCalledTimes(1);
    const [jpeg, capturedAt] = onFrame.mock.calls[0] as [Blob, number];
    expect(await jpeg.text()).toBe("2");
    expect(capturedAt).toBe(detectedAt(2));
    const encoder = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock
      .contexts[0] as HTMLCanvasElement;
    expect([encoder.width, encoder.height]).toEqual([FRAME_WIDTH, 360]);
  });

  it("다음 1초는 새로 고르고, 얼굴이 잡히지 않은 1초는 넘기지 않는다", async () => {
    const onFrame = vi.fn();
    renderHook(() => useGazeTracker(stream, onFrame));
    await loaded();
    await tick(FRAME_WINDOW_MS / GAZE_INTERVAL_MS + 1);
    expect(onFrame).toHaveBeenCalledTimes(1);

    blinkScore.mockReturnValue(null);
    await tick(FRAME_WINDOW_MS / GAZE_INTERVAL_MS);

    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("넘길 곳이 없어도 시선은 그대로 잰다", async () => {
    renderHook(() => useGazeTracker(stream));
    await loaded();
    await tick(FRAME_WINDOW_MS / GAZE_INTERVAL_MS + 1);

    expect(useGazeStore.getState().frames).toHaveLength(FRAME_WINDOW_MS / GAZE_INTERVAL_MS + 1);
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  });
});
