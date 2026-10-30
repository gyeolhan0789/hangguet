"use client";

import { useEffect } from "react";

import { gazeSample } from "@/lib/interview/gaze";
import { useGazeStore } from "@/stores/gaze-store";

// S06 화상 면접 동안 내 카메라 영상으로 시선을 잰다. 영상은 브라우저 밖으로 보내지 않고, 면접을 끝낼 때 비율만 5.8로 보낸다.
// 기준: API 명세 5.8 gazeRatio · MediaPipe Face Landmarker 웹 가이드(https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)
// 모델은 MediaPipe 공식 모델(Apache-2.0) 원본이다:
// https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

/** 재는 간격. 카메라는 초당 30장이지만 비율에는 초당 10장이면 충분하고, 면접관 3D · 송출과 함께 도는 CPU를 아낀다 */
export const GAZE_INTERVAL_MS = 100;
const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/face_landmarker.task";

/**
 * stream의 카메라로 면접 화면에 있는 동안 시선을 재 gaze-store에 쌓는다. 화면에 들어오면 지난 면접의 값을 비운다.
 * 얼굴이 잡히지 않은 프레임도 쌓는다(안 본 것으로 센다). 영상이 멈춰 같은 프레임이면(탭을 가려 재생이 멈춤 등) 재지 않는다.
 * MediaPipe를 불러오지 못하거나 카메라가 없으면 재지 않고 넘어간다(면접은 그대로 진행되고 5.8에 시선을 보내지 않는다).
 */
export function useGazeTracker(stream: MediaStream | null) {
  useEffect(() => {
    useGazeStore.getState().reset();
  }, []);

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
            useGazeStore.getState().addFrame(gazeSample(landmarker.detectForVideo(video, now)));
          } catch {
            // 인식이 실패하면 그때까지 잰 값만 쓰고 멈춘다
            clearInterval(timer);
          }
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
