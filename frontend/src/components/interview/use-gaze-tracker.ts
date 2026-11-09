"use client";

import { useEffect, useRef } from "react";

import { blinkScore, gazeSample } from "@/lib/interview/gaze";
import { useGazeStore } from "@/stores/gaze-store";

// S06 화상 면접 동안 내 카메라 영상으로 시선을 잰다. 시선 영상은 브라우저 밖으로 보내지 않고, 면접을 끝낼 때 비율만 5.8로 보낸다.
// 같은 측정으로 1초마다 눈을 가장 크게 뜬 사진 1장을 골라 onFrame으로 넘긴다(인상 판단, AI 명세 6.3 interview.frame · 6.6).
// 기준: API 명세 5.8 gazeRatio · MediaPipe Face Landmarker 웹 가이드(https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)
// 모델은 MediaPipe 공식 모델(Apache-2.0) 원본이다:
// https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

/** 재는 간격. 카메라는 초당 30장이지만 비율에는 초당 10장이면 충분하고, 면접관 3D · 송출과 함께 도는 CPU를 아낀다 */
export const GAZE_INTERVAL_MS = 100;
/** 인상 판단 사진을 고르는 구간(AI 명세 6.3: 1초마다 1장) */
export const FRAME_WINDOW_MS = 1000;
/** 보내는 사진 가로(px). Jev 이미지는 가로 · 세로 280~1568px이다(Jev 문서 images) */
export const FRAME_WIDTH = 640;
const FRAME_QUALITY = 0.8;
const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/face_landmarker.task";

/** 고른 사진(JPEG)과 찍은 시각(performance.now 기준) */
type FrameHandler = (jpeg: Blob, capturedAt: number) => void;

/**
 * stream의 카메라로 면접 화면에 있는 동안 시선을 재 gaze-store에 쌓는다. 화면에 들어오면 지난 면접의 값을 비우고,
 * 같은 면접을 새로고침해 들어온 것이면(sessionId) 그때까지 잰 값에 이어 쌓는다.
 * 얼굴이 잡히지 않은 프레임도 쌓는다(안 본 것으로 센다). 영상이 멈춰 같은 프레임이면(탭을 가려 재생이 멈춤 등) 재지 않는다.
 * MediaPipe를 불러오지 못하거나 카메라가 없으면 재지 않고 넘어간다(면접은 그대로 진행되고 5.8에 시선을 보내지 않는다).
 *
 * 영상을 캔버스에 찍은 뒤 그 캔버스를 잰다. 잰 사진과 onFrame으로 넘기는 사진이 같아야 하기 때문이다.
 * 1초마다 그동안 eyeBlink가 가장 작은(눈을 가장 크게 뜬) 프레임을 넘긴다. 얼굴이 잡히지 않은 1초는 넘기지 않는다.
 */
export function useGazeTracker(
  stream: MediaStream | null,
  onFrame?: FrameHandler,
  /** 면접 id. 주면 같은 면접을 새로고침한 경우 잰 값을 이어 쓴다(gaze-store) */
  sessionId?: number,
) {
  const frameHandler = useRef(onFrame);
  useEffect(() => {
    frameHandler.current = onFrame;
  });

  useEffect(() => {
    if (sessionId === undefined) useGazeStore.getState().reset();
    else useGazeStore.getState().start(sessionId);
  }, [sessionId]);

  useEffect(() => {
    const camera = stream?.getVideoTracks()[0];
    if (!camera) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let close: (() => void) | undefined;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([camera]);
    // 찍을 캔버스와 이번 1초의 가장 눈 뜬 프레임. 더 뜬 프레임이 나오면 맞바꾼다
    let shot = document.createElement("canvas");
    let best = document.createElement("canvas");
    const encoder = document.createElement("canvas");
    let bestBlink = Infinity;
    let bestAt = 0;
    let windowStart = -1;

    function capture(): HTMLCanvasElement | null {
      if (!video.videoWidth || !video.videoHeight) return null;
      const context = shot.getContext("2d");
      if (!context) return null;
      if (shot.width !== video.videoWidth || shot.height !== video.videoHeight) {
        shot.width = video.videoWidth;
        shot.height = video.videoHeight;
      }
      context.drawImage(video, 0, 0, shot.width, shot.height);
      return shot;
    }

    function choose(blink: number | null, now: number) {
      if (blink === null || blink >= bestBlink) return;
      [shot, best] = [best, shot];
      bestBlink = blink;
      bestAt = now;
    }

    function emit(now: number) {
      if (windowStart < 0) windowStart = now;
      if (now - windowStart < FRAME_WINDOW_MS) return;
      windowStart = now;
      const handler = frameHandler.current;
      const capturedAt = bestAt;
      const found = bestBlink !== Infinity;
      bestBlink = Infinity;
      const context = encoder.getContext("2d");
      if (!found || !handler || !context) return;
      encoder.width = FRAME_WIDTH;
      encoder.height = Math.round((FRAME_WIDTH * best.height) / best.width);
      context.drawImage(best, 0, 0, encoder.width, encoder.height);
      encoder.toBlob(
        (jpeg) => {
          if (jpeg && !disposed) handler(jpeg, capturedAt);
        },
        "image/jpeg",
        FRAME_QUALITY,
      );
    }

    void (async () => {
      try {
        const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const files = await FilesetResolver.forVisionTasks(WASM_PATH);
        const landmarker = await FaceLandmarker.createFromOptions(files, {
          // 면접관 3D가 WebGL을 쓰고 있어 GPU 대신 CPU(WASM)로 돌린다
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        if (disposed) {
          landmarker.close();
          return;
        }
        close = () => landmarker.close();
        await video.play();
        // 재생을 기다리는 사이 화면을 떠났으면 타이머를 만들지 않는다
        if (disposed) return;
        let lastTime = -1;
        let lastVideoTime = -1;
        timer = setInterval(() => {
          // VIDEO 모드는 시각이 늘어야 한다. 같은 영상 프레임은 다시 재지 않는다
          const now = performance.now();
          if (
            video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            now <= lastTime ||
            video.currentTime === lastVideoTime
          ) {
            return;
          }
          lastTime = now;
          lastVideoTime = video.currentTime;
          try {
            // 캔버스를 쓸 수 없으면 시선만 영상으로 잰다
            const image = capture();
            const result = landmarker.detectForVideo(image ?? video, now);
            useGazeStore.getState().addFrame(gazeSample(result));
            if (image) choose(blinkScore(result), now);
          } catch {
            // 인식이 실패하면 그때까지 잰 값만 쓰고 멈춘다
            clearInterval(timer);
            return;
          }
          emit(now);
        }, GAZE_INTERVAL_MS);
      } catch {
        // 시선 측정 실패는 면접 진행에 영향을 주지 않는다.
      }
    })();

    return () => {
      disposed = true;
      clearInterval(timer);
      close?.();
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);
}
