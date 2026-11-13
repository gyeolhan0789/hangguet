"use server";

import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { api, idempotencyHeaders } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import {
  getProblemDetail,
  RETRY_LATER,
  toFormActionResult,
  type FormActionResult,
} from "@/lib/api/problem-detail";
import type { SessionActionResult } from "@/lib/interview/actions";
import { idempotencyKeySchema, idSchema } from "@/lib/interview/schemas";
import { groupPath, interviewPath, ROUTES } from "@/lib/routes";
import type {
  AnswerDraftRequest,
  ExtendResponse,
  GroupCreateRequest,
  GroupJoinRequest,
  GroupResponse,
  ReadyRequest,
} from "@/types/api";

import {
  answerDraftSchema,
  groupCreateSchema,
  groupJoinSchema,
  type GroupCreateValues,
  type GroupJoinValues,
} from "./schemas";

// 기준: BE Swagger 10.1 ~ 10.9(그룹 면접. 웹 mock에는 없다) · API 명세 10.10(그룹 세션의 기존 API 규칙)
// 실패는 서버 문구(detail)를 그대로 보여 준다. 화면 이동이 필요한 코드만 따로 나눈다.

/** 서버가 실패로 답했으면 다음에는 새 멱등 키로 보낸다(응답을 못 받은 실패는 같은 키로 다시 보낸다). */
function failed(error: unknown): SessionActionResult {
  return {
    ...toFormActionResult(error, []),
    ...(getProblemDetail(error) && { keySpent: true }),
  };
}

/** 10.1 그룹을 만들고 G01 대기실로 간다. 방장의 면접도 함께 만들어 개인 맞춤 질문 준비를 시작한다. */
export async function createGroup(
  values: GroupCreateValues,
  idempotencyKey: string,
): Promise<SessionActionResult> {
  const parsed = groupCreateSchema.safeParse(values);
  if (!parsed.success || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    return { formError: "그룹 정보를 확인해 주세요." };
  }
  const body: GroupCreateRequest = parsed.data;
  let data: GroupResponse;
  try {
    ({ data } = await api.post<GroupResponse>(endpoints.groups.root, body, {
      headers: idempotencyHeaders(idempotencyKey),
    }));
  } catch (error) {
    unstable_rethrow(error);
    // 그사이 지원서가 없어졌으면 처음 단계(S03)로 보낸다(5.1과 같은 처리).
    if (getProblemDetail(error)?.code === "APPLICATION_NOT_FOUND") redirect(ROUTES.practice);
    return failed(error);
  }
  redirect(groupPath(data.groupId));
}

/** 10.3 초대 코드로 그룹에 들어가 G01 대기실로 간다. 면접 방식 · 면접관은 그룹 값이다. */
export async function joinGroup(
  values: GroupJoinValues,
  idempotencyKey: string,
): Promise<SessionActionResult> {
  const parsed = groupJoinSchema.safeParse(values);
  if (!parsed.success || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    return { formError: "참가 정보를 확인해 주세요." };
  }
  const body: GroupJoinRequest = parsed.data;
  let data: GroupResponse;
  try {
    ({ data } = await api.post<GroupResponse>(endpoints.groups.join, body, {
      headers: idempotencyHeaders(idempotencyKey),
    }));
  } catch (error) {
    unstable_rethrow(error);
    // 404(GROUP_NOT_FOUND · APPLICATION_NOT_FOUND)도 이 화면에 머물며 서버 문구를 보여 준다(BE Swagger 10.3). 지원서는 같은 화면에서
    // 다시 고를 수 있어 10.1처럼 S03으로 보내지 않는다.
    return failed(error);
  }
  redirect(groupPath(data.groupId));
}

/** 10.5 준비 · 준비 취소. 성공하면 대기실을 다시 그린다. */
export async function setGroupReady(
  groupId: number,
  ready: boolean,
): Promise<FormActionResult<never>> {
  if (!idSchema.safeParse(groupId).success) return { formError: RETRY_LATER };
  const body: ReadyRequest = { ready };
  try {
    await api.put<GroupResponse>(endpoints.groups.ready(groupId), body);
  } catch (error) {
    unstable_rethrow(error);
    // 그룹이 없어졌으면(404) 대기실 페이지가 10.4 404에서 하는 것과 같이 홈으로 간다(사용자 결정 2026-11-12: 나가면 홈)
    if (getProblemDetail(error)?.code === "GROUP_NOT_FOUND") redirect(ROUTES.home);
    refresh();
    return toFormActionResult(error, []);
  }
  refresh();
  return {};
}

/** 10.6 대기실(또는 시작 실패)에서 나가 홈으로 간다. 내 면접은 시작하지 않은 채 남는다. */
export async function leaveGroup(groupId: number): Promise<FormActionResult<never>> {
  if (!idSchema.safeParse(groupId).success) return { formError: RETRY_LATER };
  try {
    await api.delete(endpoints.groups.leave(groupId));
  } catch (error) {
    unstable_rethrow(error);
    // 이미 없는 그룹이면 나간 것과 같다.
    if (getProblemDetail(error)?.code !== "GROUP_NOT_FOUND") {
      refresh();
      return toFormActionResult(error, []);
    }
  }
  redirect(ROUTES.home);
}

/**
 * 10.7 방장이 그룹 면접을 시작하고 내 면접 화면으로 간다. 다른 참가자는 대기실의 2초 조회(10.4)로 IN_PROGRESS를 보고 들어온다.
 * 조건이 안 맞으면(409 GROUP_NOT_READY 등) 대기실을 다시 그리고 서버 문구를 보여 준다. 그룹이 없어졌으면(404) 10.5와 같이 홈으로 간다.
 * 응답의 방장 room(입장 정보)은 쓰지 않는다: 면접 화면이 다른 참가자와 같이 5.14로 입장 정보를 받는다(5.4 뒤 S06과 같은 길).
 */
export async function startGroup(
  groupId: number,
  idempotencyKey: string,
): Promise<SessionActionResult> {
  if (
    !idSchema.safeParse(groupId).success ||
    !idempotencyKeySchema.safeParse(idempotencyKey).success
  ) {
    return { formError: RETRY_LATER };
  }
  let data: GroupResponse;
  try {
    ({ data } = await api.post<GroupResponse>(endpoints.groups.start(groupId), undefined, {
      headers: idempotencyHeaders(idempotencyKey),
    }));
  } catch (error) {
    unstable_rethrow(error);
    if (getProblemDetail(error)?.code === "GROUP_NOT_FOUND") redirect(ROUTES.home);
    refresh();
    return failed(error);
  }
  redirect(interviewPath(data.mySessionId));
}

export type ExtendActionResult = { ok: true } | { ok: false; formError: string };

/**
 * 10.8 화상 그룹 면접에서 지금 답변자가 답변 시간을 1분 늘린다(남은 30초 이하 · 한 번). 화면은 새 마감을 면접방 정보(10.11)로 받아
 * 응답의 deadlineAt은 쓰지 않는다.
 */
export async function extendTurn(groupId: number): Promise<ExtendActionResult> {
  if (!idSchema.safeParse(groupId).success) return { ok: false, formError: RETRY_LATER };
  try {
    await api.post<ExtendResponse>(endpoints.groups.extend(groupId));
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, formError: toFormActionResult(error, []).formError ?? RETRY_LATER };
  }
}

/**
 * 10.9 그룹 채팅 면접에서 작성 중인 답변을 저장한다(최종 답변이 아니다). 실패해도(409 QUESTION_CLOSED 등) 화면은 그대로 두고
 * 다음 저장 때 다시 보낸다(API 명세 10.9: 마감 확정은 마지막으로 저장된 글을 쓴다).
 */
export async function saveAnswerDraft(
  sessionId: number,
  questionId: number,
  content: string,
): Promise<void> {
  const parsed = answerDraftSchema.safeParse({ content });
  if (
    !idSchema.safeParse(sessionId).success ||
    !idSchema.safeParse(questionId).success ||
    !parsed.success
  ) {
    return;
  }
  const body: AnswerDraftRequest = parsed.data;
  try {
    await api.put(endpoints.interviews.answerDraft(sessionId, questionId), body);
  } catch (error) {
    unstable_rethrow(error);
  }
}
