import { create } from "zustand";

// 비회원이 연 문의(I04 문의 확인 · I01-1 접수 완료 → I03). 조회 비밀번호는 9.3 ~ 9.5를 부를 때마다 보내야 하므로
// 화면을 옮기는 동안 메모리에만 들고 있는다(쿠키 · 주소 · localStorage에 남기지 않는다). 새로고침하면 사라져 I04로 돌아간다.

interface GuestInquiryState {
  inquiryId: number | null;
  accessPassword: string | null;
  open: (inquiryId: number, accessPassword: string) => void;
  clear: () => void;
}

export const useGuestInquiryStore = create<GuestInquiryState>((set) => ({
  inquiryId: null,
  accessPassword: null,
  open: (inquiryId, accessPassword) => set({ inquiryId, accessPassword }),
  clear: () => set({ inquiryId: null, accessPassword: null }),
}));
