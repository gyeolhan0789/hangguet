import { create } from "zustand";

import type { NoticeItem } from "@/types/api";

// 모바일(sm 미만) 헤더 햄버거 메뉴의 열림과, 메뉴에서 고른 공지(C02로 연 공지).
// 헤더(layouts/header/header.tsx)와 메뉴 항목(layouts/header/mobile-menu.tsx)이 같이 쓴다.
// 공지를 고르면 메뉴는 닫고 C02만 남긴다(메뉴 패널이 사라져도 모달이 남도록 메뉴 밖 상태로 둔다).

interface MobileMenuState {
  open: boolean;
  /** 메뉴에서 골라 C02로 연 공지. null이면 닫혀 있다 */
  notice: NoticeItem | null;
  toggle: () => void;
  close: () => void;
  openNotice: (notice: NoticeItem) => void;
  closeNotice: () => void;
}

export const useMobileMenuStore = create<MobileMenuState>((set) => ({
  open: false,
  notice: null,
  toggle: () => set((state) => ({ open: !state.open })),
  close: () => set({ open: false }),
  openNotice: (notice) => set({ open: false, notice }),
  closeNotice: () => set({ notice: null }),
}));
