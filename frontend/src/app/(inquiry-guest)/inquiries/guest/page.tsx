import type { Metadata } from "next";

import { GuestInquiryView } from "./_components/guest-inquiry-view";

export const metadata: Metadata = { title: "문의 확인 · 한끗" };

// I04 비회원 문의 확인 → 확인하면 같은 화면에서 I03 문의 상세. 기준: Figma I04 · I03 · I03-1(화이트 · 다크) · 기획 메모 I04 · I03
// 조회 비밀번호는 화면(메모리)에만 있어 서버 컴포넌트가 미리 불러올 수 없다. 9.3은 서버 액션으로 부른다.
export default function GuestInquiryPage() {
  return (
    <main className="flex flex-1 flex-col">
      <GuestInquiryView />
    </main>
  );
}
