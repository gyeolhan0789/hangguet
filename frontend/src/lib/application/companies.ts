import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { CompanyItem, CompanyListResponse } from "@/types/api";

// 기준: Swagger 4.7 회사 목록(GET /companies → 200 CompanyListResponse, 영문 다음 한글 가나다순, 페이지 없음)

/** 4.7 회사 목록. 서버 컴포넌트에서만 부른다. */
export async function getCompanies(): Promise<CompanyItem[]> {
  const { data } = await api.get<CompanyListResponse>(endpoints.applications.companies);
  return data.content;
}
