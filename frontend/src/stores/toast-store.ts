import { create } from "zustand";

/** 화면 아래 토스트 하나(Figma S06-F Mic Toast 모양). 아이콘은 흰색으로 칠한다. */
export interface ToastMessage {
  text: string;
  /** 문구 앞 아이콘. 예: 체크 */
  icon?: string;
}

interface ToastState {
  /** 지금 떠 있는 토스트. 같은 문구를 연달아 띄워도 다시 나타나도록 띄울 때마다 새 id를 준다. */
  toast: (ToastMessage & { id: number }) | null;
  show: (message: ToastMessage) => void;
  hide: () => void;
}

// 여러 컴포넌트(준비 중 카드 · 설정 줄)가 화면에 하나뿐인 토스트를 나눠 쓴다(AGENTS.md: 나눠 쓰는 상태는 zustand).
export const useToastStore = create<ToastState>()((set) => ({
  toast: null,
  show: (message) => set({ toast: { ...message, id: Date.now() } }),
  hide: () => set({ toast: null }),
}));
