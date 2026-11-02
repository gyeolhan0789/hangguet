import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/legal-document";
import { InquiryHead, InquiryPage } from "@/components/inquiry/inquiry-ui";
import { TERMS_EFFECTIVE_DATE, TERMS_OF_SERVICE } from "@/lib/legal/documents";

// 서비스 이용약관. 기준: lib/legal/documents.ts(공정위 표준약관 제10023호 바탕) · 본문 틀은 문의 화면(InquiryPage)과 같다.

export const metadata: Metadata = { title: `${TERMS_OF_SERVICE.title} · 한끗` };

export default function TermsPage() {
  return (
    <main className="flex flex-1 flex-col">
      <InquiryPage>
        <InquiryHead title={TERMS_OF_SERVICE.title} sub={`시행일 ${TERMS_EFFECTIVE_DATE}`} />
        <LegalDocumentView doc={TERMS_OF_SERVICE} />
      </InquiryPage>
    </main>
  );
}
