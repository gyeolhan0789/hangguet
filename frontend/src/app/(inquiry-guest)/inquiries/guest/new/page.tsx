import type { Metadata } from "next";

import { InquiryHead, InquiryPage } from "@/components/inquiry/inquiry-ui";

import { GuestInquiryForm } from "./_components/guest-inquiry-form";

export const metadata: Metadata = { title: "문의하기 · 한끗" };

// I01-B 문의하기(비회원) · I01-1 문의 접수 완료. 기준: Figma I01-B · I01-1(화이트 · 다크) · 기획 메모 I01-B(I04 [+ 문의하기]로 진입)
export default function GuestInquiryNewPage() {
  return (
    <main className="flex flex-1 flex-col">
      <InquiryPage>
        <InquiryHead title="문의하기" sub="로그인하지 않아도 문의를 남길 수 있어요" />
        <GuestInquiryForm />
      </InquiryPage>
    </main>
  );
}
