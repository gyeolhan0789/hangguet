import type { Metadata } from "next";

import { InquiryHead, InquiryPage } from "@/components/inquiry/inquiry-ui";
import { ROUTES } from "@/lib/routes";

import { InquiryForm } from "../_components/inquiry-form";

export const metadata: Metadata = { title: "문의하기 · 한끗" };

// I01 문의하기(회원). 기준: Figma I01(화이트 · 다크) · 기획 메모 I01(I02 [+ 문의하기]로 진입, [취소] → I02)
export default function InquiryNewPage() {
  return (
    <main className="flex flex-1 flex-col">
      <InquiryPage>
        <InquiryHead back={{ label: "내 문의", href: ROUTES.inquiries }} title="문의하기" />
        <InquiryForm />
      </InquiryPage>
    </main>
  );
}
