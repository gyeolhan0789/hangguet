import { create } from "zustand";

import type { MeResponse } from "@/types/api";

interface UserState {
  /** 로그인한 회원. 로그인 전·로그아웃 후에는 null */
  user: MeResponse | null;
  /** 서버 컴포넌트가 받아 온 내 정보(2.1)로 채운다. */
  setUser: (user: MeResponse) => void;
  /** 닉네임 변경·프로필 사진 등록·삭제처럼 일부만 바뀌었을 때 */
  updateUser: (changes: Partial<MeResponse>) => void;
  clearUser: () => void;
}

// 모듈 전역 store라 서버 렌더링 중에 값을 넣으면 다른 요청과 섞인다. 값은 클라이언트에서만 넣는다.
export const useUserStore = create<UserState>()((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  updateUser: (changes) =>
    set((state) => (state.user ? { user: { ...state.user, ...changes } } : state)),
  clearUser: () => set({ user: null }),
}));
