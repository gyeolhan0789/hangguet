import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { InquiryListResponse, InquiryResponse, PageQuery } from "@/types/api";

// 기준: Swagger 9.2 내 문의 목록(GET /inquiries → InquiryListResponse, page 0부터 · size 1~20, 기본 10)
// · 9.3 문의 조회(GET /inquiries/{inquiryId} → InquiryResponse · 404 INQUIRY_NOT_FOUND). 회원 화면(I02 · I03)의 서버 컴포넌트에서만 부른다.
// 비회원 문의 조회는 조회 비밀번호가 화면에 있으므로 서버 액션(actions.ts openGuestInquiry)으로 부른다.

/** 9.2 내 문의 목록 */
export async function getMyInquiries(page: number): Promise<InquiryListResponse> {
  const params: PageQuery = { page, size: 10 };
  const { data } = await api.get<InquiryListResponse>(endpoints.inquiries.root, { params });
  return data;
}

/** 9.3 문의 조회(회원) */
export async function getInquiry(inquiryId: number): Promise<InquiryResponse> {
  const { data } = await api.get<InquiryResponse>(endpoints.inquiries.detail(inquiryId));
  return data;
}
