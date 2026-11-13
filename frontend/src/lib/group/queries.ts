import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail } from "@/lib/api/problem-detail";
import type { GroupResponse, InviteResponse } from "@/types/api";

import { inviteCodeSchema } from "./schemas";

// 기준: BE Swagger 10.2 초대 확인(404 GROUP_NOT_FOUND: 없는 코드 · 이미 시작했거나 취소된 그룹)
// · 10.4 그룹 조회(404 GROUP_NOT_FOUND: 없거나 참가자가 아님)

/** 10.4 그룹 조회. 없거나 참가자가 아니면(404) null. 서버 컴포넌트에서만 부른다. */
export async function getGroup(groupId: number): Promise<GroupResponse | null> {
  try {
    const { data } = await api.get<GroupResponse>(endpoints.groups.detail(groupId));
    return data;
  } catch (error) {
    if (getProblemDetail(error)?.code === "GROUP_NOT_FOUND") return null;
    throw error;
  }
}

/** 10.2 초대 확인. 형식이 틀리거나 들어갈 수 없는 코드면(404) null. 서버 컴포넌트에서만 부른다. */
export async function getInvite(inviteCode: string): Promise<InviteResponse | null> {
  if (!inviteCodeSchema.safeParse(inviteCode).success) return null;
  try {
    const { data } = await api.get<InviteResponse>(endpoints.groups.invite(inviteCode));
    return data;
  } catch (error) {
    if (getProblemDetail(error)?.code === "GROUP_NOT_FOUND") return null;
    throw error;
  }
}

/** 주소의 groupId(양의 정수)를 읽는다. 없거나 형식이 틀리면 null */
export { parsePositiveId as parseGroupId } from "@/lib/parse-id";
