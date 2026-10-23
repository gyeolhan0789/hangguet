import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { NoticesResponse } from "@/types/api";

// 기준: Swagger 8.8 공지 목록(GET /notices → NoticesResponse: 게시 중인 공지 최신순 · 공지마다 read) · Figma C03 공지 목록 펼침
// · C02 공지 모달

/** 8.8 공지 목록. 서버 컴포넌트에서만 부른다. */
export async function getNotices(): Promise<NoticesResponse> {
  const { data } = await api.get<NoticesResponse>(endpoints.notices.root);
  return data;
}
