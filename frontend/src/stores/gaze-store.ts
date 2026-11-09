import { create } from "zustand";

import type { GazeFrame } from "@/lib/interview/gaze";

// S06 화상 면접 동안 잰 시선. 측정(use-gaze-tracker)과 면접 끝내기(5.8, 자동 종료 · S06-E 모달)가 나눠 쓴다.
// 기준: API 명세 5.8 gazeRatio(면접 동안 면접관을 바라본 시간 비율)
// 같은 탭에서 새로고침해도 면접 동안 잰 값이 이어지도록 sessionStorage에 면접 id와 함께 둔다(탭을 닫으면 지워진다).
// 매 프레임 쓰지 않고 SAVE_EVERY_MS마다 쓴다. 새로고침 직전 그 사이에 잰 값은 잃는다.

export const GAZE_STORAGE_KEY = "a301-gaze";
/** sessionStorage에 쓰는 간격 */
export const SAVE_EVERY_MS = 10_000;

interface SavedGaze {
  sessionId: number;
  frames: GazeFrame[];
}

interface GazeState {
  /** 잰 프레임(얼굴이 안 잡혔으면 null) */
  frames: GazeFrame[];
  addFrame: (frame: GazeFrame) => void;
  /** 면접 화면에 들어올 때 부른다. 같은 면접을 새로고침한 것이면 저장해 둔 값을 이어 쓰고, 아니면 비운다 */
  start: (sessionId: number) => void;
  reset: () => void;
}

let current: number | null = null;
let savedAt = 0;

function read(): SavedGaze | null {
  try {
    const raw = sessionStorage.getItem(GAZE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedGaze) : null;
  } catch {
    return null;
  }
}

function write(frames: GazeFrame[]) {
  if (current === null) return;
  try {
    sessionStorage.setItem(GAZE_STORAGE_KEY, JSON.stringify({ sessionId: current, frames }));
  } catch {
    // 저장 공간이 없거나 막혀 있으면 이 탭 메모리의 값만 쓴다
  }
}

function clear() {
  try {
    sessionStorage.removeItem(GAZE_STORAGE_KEY);
  } catch {
    // 위와 같다
  }
}

export const useGazeStore = create<GazeState>()((set, get) => ({
  frames: [],
  // 초당 10번 쌓이고 끝낼 때만 읽는다(구독하는 화면이 없다). 30분이면 1만 8천 개라 매번 배열을 복사하지 않고 이어 붙인다
  addFrame: (frame) => {
    const { frames } = get();
    frames.push(frame);
    const now = Date.now();
    if (now - savedAt >= SAVE_EVERY_MS) {
      savedAt = now;
      write(frames);
    }
  },
  start: (sessionId) => {
    const saved = read();
    current = sessionId;
    savedAt = Date.now();
    if (saved?.sessionId === sessionId && Array.isArray(saved.frames)) {
      set({ frames: saved.frames });
      return;
    }
    clear();
    set({ frames: [] });
  },
  reset: () => {
    current = null;
    clear();
    set({ frames: [] });
  },
}));
