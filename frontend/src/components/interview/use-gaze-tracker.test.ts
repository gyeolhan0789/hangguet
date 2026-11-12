// 기준: API 명세 5.8 gazeRatio(화면이 면접 내내 브라우저에서 잰 값) · AI 명세 6.3 interview.frame(1초마다 1장)
// · MediaPipe Face Landmarker 웹 가이드(FilesetResolver.forVisionTasks · FaceLandmarker.createFromOptions · VIDEO 모드 detectForVideo)
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { gazeSample } from "@/lib/interview/gaze";
import { useGazeStore } from "@/stores/gaze-store";
import { deferred } from "@/test/deferred";

import { useGazeTracker } from "./use-gaze-tracker";

// 경계 mock: MediaPipe(WASM 얼굴 인식). 인식 결과는 테스트가 정한다
const landmarker = vi.hoisted(() => ({ detectForVideo: vi.fn(), close: vi.fn() }));
const mediapipe = vi.hoisted(() => ({
  FaceLandmarker: { createFromOptions: vi.fn() },
  FilesetResolver: { forVisionTasks: vi.fn() },
}));
vi.mock("@mediapipe/tasks-vision", () => mediapipe);

// 예시 데이터: Face Landmarker 결과(두 눈 eyeBlink 점수 · 정면을 보는 열 우선 4×4 행렬)
function face(blink: number): FaceLandmarkerResult {
  const data = Array<number>(16).fill(0);
  data[10] = 1;
  return {
    faceLandmarks: [[]],
    faceBlendshapes: [
      {
        categories: [
          { index: 0, score: blink, categoryName: "eyeBlinkLeft", displayName: "" },
          { index: 1, score: blink, categoryName: "eyeBlinkRight", displayName: "" },
        ],
        headIndex: 0,
        headName: "",
      },
    ],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data }],
  };
}
const NO_FACE = {
  faceLandmarks: [],
  faceBlendshapes: [],
  facialTransformationMatrixes: [],
} as unknown as FaceLandmarkerResult;
const SAMPLE = gazeSample(face(0.1));

const camera = {} as MediaStreamTrack;
const stream = { getVideoTracks: () => [camera] } as unknown as MediaStream;

/** 영상 상태(jsdom에는 영상 재생이 없어 테스트가 정한다) */
let readyState: number;
let videoTime: number;
/** 캔버스마다 마지막으로 찍은 프레임 번호(jsdom에는 캔버스 그리기가 없어 그린 내용 대신 번호로 따라간다) */
let drawn: WeakMap<object, number>;
let frameNo: number;
/** toBlob에 넘긴 콜백(사진 만들기가 끝나는 때를 테스트가 정한다) */
let pendingBlobs: { canvas: HTMLCanvasElement; done: BlobCallback }[];

/** MediaPipe 준비 · 영상 재생까지 끝낸다 */
function loaded() {
  return act(async () => vi.advanceTimersByTimeAsync(0));
}
/** 재는 간격(100ms)만큼 n번 지난다. 영상은 advanceVideo면 매번 다음 프레임으로 넘어간다 */
async function tick(n: number, advanceVideo = true) {
  for (let i = 0; i < n; i++) {
    if (advanceVideo) videoTime += 0.1;
    await act(async () => vi.advanceTimersByTimeAsync(100));
  }
}
/** 만들던 사진을 모두 끝낸다 */
function finishBlobs() {
  pendingBlobs.splice(0).forEach(({ canvas, done }) => {
    done(new Blob([String(drawn.get(canvas))], { type: "image/jpeg" }));
  });
}
const frames = () => useGazeStore.getState().frames;
const detectedAt = (n: number) => landmarker.detectForVideo.mock.calls[n - 1][1] as number;

beforeEach(() => {
  vi.useFakeTimers();
  useGazeStore.getState().reset();
  sessionStorage.clear();
  readyState = HTMLMediaElement.HAVE_ENOUGH_DATA;
  videoTime = 0;
  drawn = new WeakMap();
  frameNo = 0;
  pendingBlobs = [];
  mediapipe.FilesetResolver.forVisionTasks.mockResolvedValue({});
  mediapipe.FaceLandmarker.createFromOptions.mockResolvedValue(landmarker);
  landmarker.detectForVideo.mockReturnValue(face(0.1));
  // 경계 mock: 미디어(MediaStream · 영상 재생)와 캔버스(그리기 · JPEG 만들기)
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(readonly tracks: MediaStreamTrack[]) {}
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockImplementation(() => readyState);
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(() => videoTime);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(720);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const context = {
      canvas: this,
      drawImage(source: object) {
        drawn.set(
          context.canvas,
          source instanceof HTMLVideoElement ? ++frameNo : drawn.get(source)!,
        );
      },
    };
    return context as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement["getContext"]);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    done: BlobCallback,
  ) {
    pendingBlobs.push({ canvas: this, done });
  });
});

describe("useGazeTracker · 화상 면접 시선 측정", () => {
  describe("시선 재기", () => {
    describe("정상 처리", () => {
      it("카메라 영상을 100ms마다 재서 시선을 쌓는다", async () => {
        renderHook(() => useGazeTracker(stream));
        await loaded();

        await act(async () => vi.advanceTimersByTimeAsync(99));
        expect(frames()).toEqual([]);
        await tick(3);

        expect(frames()).toEqual([SAMPLE, SAMPLE, SAMPLE]);
      });

      it("얼굴이 잡히지 않은 프레임은 빈 값(null)으로 쌓는다", async () => {
        landmarker.detectForVideo.mockReturnValueOnce(NO_FACE);
        renderHook(() => useGazeTracker(stream));
        await loaded();

        await tick(2);

        expect(frames()).toEqual([null, SAMPLE]);
      });
    });

    describe("상태 변화", () => {
      it("카메라가 바뀌면 이전 인식기를 닫고 새로 만들며 쌓인 값은 그대로 둔다", async () => {
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
        expect(mediapipe.FaceLandmarker.createFromOptions).toHaveBeenCalledTimes(2);
        expect(frames()).toEqual([SAMPLE, SAMPLE]);
      });
    });

    describe("입력 검증", () => {
      it("카메라가 없으면 MediaPipe를 불러오지 않는다", async () => {
        renderHook(() => useGazeTracker(null));
        await loaded();

        expect(mediapipe.FilesetResolver.forVisionTasks).not.toHaveBeenCalled();
      });

      it.each([
        {
          label: "영상이 준비되지 않았으면",
          hold: () => {
            readyState = HTMLMediaElement.HAVE_METADATA;
          },
          advanceVideo: true,
        },
        { label: "영상이 멈춰 같은 프레임이면", hold: () => {}, advanceVideo: false },
      ])("'$label' 재지 않는다", async ({ hold, advanceVideo }) => {
        renderHook(() => useGazeTracker(stream));
        await loaded();
        await tick(1);

        hold();
        await tick(3, advanceVideo);

        expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);
      });
    });

    describe("오류 처리", () => {
      it("MediaPipe를 불러오지 못하면 재지 않고 오류도 던지지 않는다", async () => {
        mediapipe.FaceLandmarker.createFromOptions.mockRejectedValue(new Error("모델을 받지 못함"));
        renderHook(() => useGazeTracker(stream));
        await loaded();

        await tick(3);

        expect(frames()).toEqual([]);
      });

      it("인식 중 오류가 나면 그때까지 잰 값만 두고 재기를 멈춘다", async () => {
        landmarker.detectForVideo.mockReturnValueOnce(face(0.1)).mockImplementation(() => {
          throw new Error("인식 실패");
        });
        renderHook(() => useGazeTracker(stream));
        await loaded();

        await tick(4);

        expect(landmarker.detectForVideo).toHaveBeenCalledTimes(2);
        expect(frames()).toEqual([SAMPLE]);
      });

      it("캔버스를 쓸 수 없으면 영상으로 시선만 재고 사진은 넘기지 않는다", async () => {
        vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
        const onFrame = vi.fn();
        renderHook(() => useGazeTracker(stream, onFrame));
        await loaded();

        await tick(11);

        expect(landmarker.detectForVideo.mock.calls[0][0]).toBeInstanceOf(HTMLVideoElement);
        expect(frames()).toHaveLength(11);
        expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("MediaPipe를 불러오는 중 화면을 떠나면 다 불러온 뒤 닫고 재지 않는다", async () => {
        const created = deferred<typeof landmarker>();
        mediapipe.FaceLandmarker.createFromOptions.mockReturnValue(created.promise);
        const { unmount } = renderHook(() => useGazeTracker(stream));
        await loaded();

        unmount();
        await act(async () => created.resolve(landmarker));
        await tick(3);

        expect(landmarker.close).toHaveBeenCalledTimes(1);
        expect(landmarker.detectForVideo).not.toHaveBeenCalled();
      });

      it("영상 재생을 기다리는 중 화면을 떠나면 재기를 시작하지 않는다", async () => {
        const playing = deferred();
        vi.mocked(HTMLMediaElement.prototype.play).mockReturnValue(playing.promise);
        const { unmount } = renderHook(() => useGazeTracker(stream));
        await loaded();

        unmount();
        await act(async () => playing.resolve());
        await tick(3);

        expect(landmarker.detectForVideo).not.toHaveBeenCalled();
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 재기를 멈추고 MediaPipe를 닫고 영상을 멈춘다", async () => {
        const { unmount } = renderHook(() => useGazeTracker(stream));
        await loaded();
        await tick(1);

        unmount();
        await tick(3);

        expect(landmarker.detectForVideo).toHaveBeenCalledTimes(1);
        expect(landmarker.close).toHaveBeenCalledTimes(1);
        expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("인상 판단 사진", () => {
    describe("정상 처리", () => {
      it("1초마다 그동안 눈을 가장 크게 뜬 프레임을 그 프레임의 시각과 함께 넘긴다", async () => {
        landmarker.detectForVideo
          .mockReturnValueOnce(face(0.3))
          .mockReturnValueOnce(face(0.05))
          .mockReturnValueOnce(NO_FACE)
          .mockReturnValue(face(0.6));
        const onFrame = vi.fn();
        renderHook(() => useGazeTracker(stream, onFrame));
        await loaded();

        await tick(11);
        finishBlobs();

        expect(onFrame).toHaveBeenCalledTimes(1);
        const [jpeg, capturedAt] = onFrame.mock.calls[0] as [Blob, number];
        expect(await jpeg.text()).toBe("2");
        expect(capturedAt).toBe(detectedAt(2));
      });

      it("넘기는 사진은 가로 640px에 원본 비율로 줄인다", async () => {
        renderHook(() => useGazeTracker(stream, vi.fn()));
        await loaded();

        await tick(11);

        const encoder = pendingBlobs[0].canvas;
        expect([encoder.width, encoder.height]).toEqual([640, 360]);
        finishBlobs();
      });

      it("onFrame이 바뀌면 다음 사진부터 새 함수로 넘긴다", async () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(({ handler }) => useGazeTracker(stream, handler), {
          initialProps: { handler: first },
        });
        await loaded();
        await tick(11);
        finishBlobs();

        rerender({ handler: second });
        await tick(10);
        finishBlobs();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
      });
    });

    describe("입력 검증", () => {
      it("얼굴이 잡히지 않은 1초는 넘기지 않는다", async () => {
        landmarker.detectForVideo.mockReturnValue(NO_FACE);
        const onFrame = vi.fn();
        renderHook(() => useGazeTracker(stream, onFrame));
        await loaded();

        await tick(11);

        expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
        expect(onFrame).not.toHaveBeenCalled();
      });

      it("사진을 만들지 못하면 넘기지 않는다", async () => {
        const onFrame = vi.fn();
        renderHook(() => useGazeTracker(stream, onFrame));
        await loaded();
        await tick(11);

        pendingBlobs[0].done(null);

        expect(onFrame).not.toHaveBeenCalled();
      });

      it("넘길 곳이 없어도 시선은 그대로 잰다", async () => {
        renderHook(() => useGazeTracker(stream));
        await loaded();

        await tick(11);

        expect(frames()).toHaveLength(11);
        expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
      });
    });

    describe("경계값", () => {
      it("1초가 다 차기 전에는 넘기지 않는다", async () => {
        renderHook(() => useGazeTracker(stream, vi.fn()));
        await loaded();

        // 첫 측정부터 900ms(10번째 측정)
        await tick(10);
        expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
        // 1,000ms(11번째 측정)
        await tick(1);
        expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1);
        finishBlobs();
      });

      it("다음 1초는 앞 1초와 상관없이 새로 고른다", async () => {
        landmarker.detectForVideo.mockReturnValueOnce(face(0.05)).mockReturnValue(face(0.3));
        const onFrame = vi.fn();
        renderHook(() => useGazeTracker(stream, onFrame));
        await loaded();
        await tick(11);
        finishBlobs();

        await tick(10);
        finishBlobs();

        expect(onFrame).toHaveBeenCalledTimes(2);
        // 둘째 1초는 앞 1초의 0.05보다 덜 떴어도 그 1초의 첫 프레임(12번째 측정)을 고른다
        expect(onFrame.mock.calls[1][1]).toBe(detectedAt(12));
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("사진을 만드는 중 화면을 떠나면 넘기지 않는다", async () => {
        const onFrame = vi.fn();
        const { unmount } = renderHook(() => useGazeTracker(stream, onFrame));
        await loaded();
        await tick(11);
        expect(pendingBlobs).toHaveLength(1);

        unmount();
        finishBlobs();

        expect(onFrame).not.toHaveBeenCalled();
      });
    });
  });
});
