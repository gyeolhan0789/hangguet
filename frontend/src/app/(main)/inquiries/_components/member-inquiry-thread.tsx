"use client";

import { useRouter } from "next/navigation";

import { InquiryThread } from "@/components/inquiry/inquiry-thread";
import { addInquiryMessage, closeInquiry, type InquiryWriteResult } from "@/lib/inquiry/actions";
import { ROUTES } from "@/lib/routes";
import type { InquiryResponse } from "@/types/api";

// 기준: 기획 메모 I03(회원: 로그인 토큰으로 9.4 · 9.5, 없는 문의(404)면 I02로) · '‹ 내 문의' → I02
// 서버 액션이 refresh로 이 화면을 다시 그려 메시지 · 상태 칩이 바뀐다.
export function MemberInquiryThread({ inquiry }: { inquiry: InquiryResponse }) {
  const router = useRouter();
  const leaveIfGone = (result: InquiryWriteResult) => {
    if (result.notFound) router.replace(ROUTES.inquiries);
    return result;
  };
  return (
    <InquiryThread
      inquiry={inquiry}
      back={{ label: "내 문의", href: ROUTES.inquiries }}
      onSend={async (content) => leaveIfGone(await addInquiryMessage(inquiry.id, content))}
      onClose={async () => leaveIfGone(await closeInquiry(inquiry.id))}
    />
  );
}
