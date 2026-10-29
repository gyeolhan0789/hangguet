import type { Metadata } from "next";
import { redirect, RedirectType } from "next/navigation";
import { Suspense } from "react";

import {
  getApplication,
  getApplicationSessions,
  parseApplicationId,
} from "@/lib/application/queries";
import { applicationPath, ROUTES } from "@/lib/routes";

import { ApplicationDetail } from "./_components/application-detail";

export const metadata: Metadata = { title: "지원서 · 한끗" };

// 지원서 상세. 기준: Figma 지원 관리 · 상세 · 상세 · 면접에 씀(화이트 · 다크) · Swagger 4.2 지원서 조회 · 4.6 지원서의 연습 면접 목록
// (404 APPLICATION_NOT_FOUND: 없거나 남의 지원서, page 0부터 · size 기본 10)
// · 사용자 결정(2026-10-29: 없는 지원서는 문의 상세처럼 목록으로)

/** Swagger 4.6 page는 int32(0 이상) */
const MAX_PAGE = 2_147_483_647;
/** Swagger 4.6 size 기본값 */
const PAGE_SIZE = 10;

/** 주소의 page. 0 이상의 int32 정수가 아니면 0 */
function parsePage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0;
  const page = Number(value);
  return page <= MAX_PAGE ? page : 0;
}

async function Application({ params, searchParams }: PageProps<"/applications/[applicationId]">) {
  const applicationId = parseApplicationId((await params).applicationId);
  if (applicationId === null) redirect(ROUTES.applications);
  const page = parsePage((await searchParams).page);
  const [application, sessions] = await Promise.all([
    getApplication(applicationId),
    getApplicationSessions(applicationId, page, PAGE_SIZE),
  ]);
  if (!application || !sessions) redirect(ROUTES.applications);
  // 면접 기록 쪽수를 넘은 주소는 첫 쪽으로 바꿔 연다.
  if (sessions.content.length === 0 && page > 0) {
    redirect(applicationPath(applicationId), RedirectType.replace);
  }
  return <ApplicationDetail application={application} sessions={sessions} />;
}

export default function ApplicationDetailPage(props: PageProps<"/applications/[applicationId]">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* 4.2 · 4.6을 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
      <Suspense fallback={null}>
        <Application {...props} />
      </Suspense>
    </main>
  );
}
