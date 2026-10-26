import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { InquiryPage } from "@/components/inquiry/inquiry-ui";
import { getProblemDetail } from "@/lib/api/problem-detail";
import { getInquiry } from "@/lib/inquiry/queries";
import { parsePositiveId } from "@/lib/parse-id";
import { ROUTES } from "@/lib/routes";
import type { InquiryResponse } from "@/types/api";

import { MemberInquiryThread } from "../_components/member-inquiry-thread";

export const metadata: Metadata = { title: "문의 상세 · 한끗" };

// I03 문의 상세(회원). 기준: Figma I03 · I03-1(화이트 · 다크) · 기획 메모 I03(없는 문의(404)면 회원은 I02로)
// · Swagger 9.3 문의 조회(404 INQUIRY_NOT_FOUND: 없거나 남의 문의)
async function Inquiry({ params }: Pick<PageProps<"/inquiries/[inquiryId]">, "params">) {
  const inquiryId = parsePositiveId((await params).inquiryId);
  if (inquiryId === null) redirect(ROUTES.inquiries);
  let inquiry: InquiryResponse;
  try {
    inquiry = await getInquiry(inquiryId);
  } catch (error) {
    if (getProblemDetail(error)?.code === "INQUIRY_NOT_FOUND") redirect(ROUTES.inquiries);
    throw error;
  }
  return <MemberInquiryThread inquiry={inquiry} />;
}

export default function InquiryDetailPage({ params }: PageProps<"/inquiries/[inquiryId]">) {
  return (
    <main className="flex flex-1 flex-col">
      <InquiryPage>
        {/* 9.3을 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
        <Suspense fallback={null}>
          <Inquiry params={params} />
        </Suspense>
      </InquiryPage>
    </main>
  );
}
