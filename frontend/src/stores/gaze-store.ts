import { create } from "zustand";

import type { GazeFrame } from "@/lib/interview/gaze";

// S06 화상 면접 동안 잰 시선. 측정(use-gaze-tracker)과 면접 끝내기(5.8, 자동 종료 · S06-E 모달)가 나눠 쓴다.
// 기준: API 명세 5.8 gazeRatio(면접 동안 면접관을 바라본 시간 비율)

interface GazeState {
  /** 잰 프레임(얼굴이 안 잡혔으면 null). 면접 화면에 들어올 때 비운다 */
  frames: GazeFrame[];
  addFrame: (frame: GazeFrame) => void;
  reset: () => void;
}

export const useGazeStore = create<GazeState>()((set, get) => ({
  frames: [],
  // 초당 10번 쌓이고 끝낼 때만 읽는다(구독하는 화면이 없다). 30분이면 1만 8천 개라 매번 배열을 복사하지 않고 이어 붙인다
  addFrame: (frame) => void get().frames.push(frame),
  reset: () => set({ frames: [] }),
}));
