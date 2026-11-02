import { create } from "zustand";

/** S01 로그인 버튼 위 오류 문구 하나. 같은 문구가 다시 와도 다시 보이도록(흔들림 · 다시 읽기) 띄울 때마다 새 id를 준다 */
export interface LoginNotice {
  text: string;
  id: number;
}

/**
 * S01 오류 문구 자리에 보일 문구. 이메일 로그인 실패(1.3)와 카카오 로그인 · 가입 실패(문구 쿠키, lib/auth/kakao.ts)가 같은 자리를
 * 쓰므로 마지막에 온 문구 하나만 남긴다. 카카오 문구는 쿠키를 지우는 서버 액션이 화면을 다시 그려도(넘길 문구가 없어도) 남는다.
 */
interface LoginNoticeState {
  notice: LoginNotice | null;
  show: (text: string) => void;
  clear: () => void;
}

let nextId = 0;

// 문구를 넘기는 쪽(LoginNotice · LoginForm)과 보여 주는 쪽(LoginForm)이 서로 다른 Suspense 경계에 있어 나눠 쓴다
// (AGENTS.md: 나눠 쓰는 상태는 zustand).
export const useLoginNoticeStore = create<LoginNoticeState>()((set) => ({
  notice: null,
  show: (text) => set({ notice: { text, id: ++nextId } }),
  clear: () => set({ notice: null }),
}));
