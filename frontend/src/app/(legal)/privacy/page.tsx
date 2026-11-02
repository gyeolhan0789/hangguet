import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/legal-document";
import { InquiryHead, InquiryPage } from "@/components/inquiry/inquiry-ui";
import { PRIVACY_EFFECTIVE_DATE, PRIVACY_POLICY } from "@/lib/legal/documents";

// 개인정보 처리방침. 기준: lib/legal/documents.ts(개인정보 처리방침 작성지침 2026. 4. 바탕) · 「개인정보 보호법」 제30조(공개)
// · 본문 틀은 문의 화면(InquiryPage)과 같다.

export const metadata: Metadata = { title: `${PRIVACY_POLICY.title} · 한끗` };

export default function PrivacyPage() {
  return (
    <main className="flex flex-1 flex-col">
      <InquiryPage>
        <InquiryHead title={PRIVACY_POLICY.title} sub={`시행일 ${PRIVACY_EFFECTIVE_DATE}`} />
        <LegalDocumentView doc={PRIVACY_POLICY} />
      </InquiryPage>
    </main>
  );
}
