import { create } from "zustand";

import type { Persona } from "@/types/api";

// S05 장치 점검에서 미리 받는 면접관 3D 모델의 상태. 준비 줄 · [면접 시작]이 질문 준비와 함께 본다.
// 기준: 사용자 결정(2026-10-22: 모델을 다 받을 때까지 '면접관이 질문을 준비하고 있어요 N%'를 띄우고 [면접 시작]을 막는다,
// 실패는 '면접 준비에 실패했어요'로 질문 준비 실패와 합친다)

/** idle 아직 안 받음 · loading 받는 중(재시도 포함) · ready 다 받음 · failed 다시 해도 안 됨 */
export type PreloadStatus = "idle" | "loading" | "ready" | "failed";

interface InterviewerPreloadState {
  /** 받고 있는 면접관 */
  persona: Persona | null;
  status: PreloadStatus;
  /** 받은 비율(0~1) */
  progress: number;
  start: (persona: Persona) => void;
  setProgress: (persona: Persona, progress: number) => void;
  finish: (persona: Persona, status: "ready" | "failed") => void;
}

export const useInterviewerPreloadStore = create<InterviewerPreloadState>()((set, get) => ({
  persona: null,
  status: "idle",
  progress: 0,
  start: (persona) => set({ persona, status: "loading", progress: 0 }),
  // 다른 면접관으로 바뀐 뒤 늦게 온 소식은 버린다.
  setProgress: (persona, progress) => {
    if (get().persona === persona && get().status === "loading") set({ progress });
  },
  finish: (persona, status) => {
    if (get().persona === persona)
      set({ status, progress: status === "ready" ? 1 : get().progress });
  },
}));
