import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { inquiryButtonClass } from "@/components/inquiry/inquiry-button-class";
import { InquiryHead, InquiryPage } from "@/components/inquiry/inquiry-ui";
import { getApplications } from "@/lib/application/queries";
import { applicationNewPath, applicationsPath } from "@/lib/routes";

import { ApplicationList } from "./_components/application-list";
import { ApplicationPager } from "./_components/application-pager";
import { SlideIn } from "./_components/slide-in";

export const metadata: Metadata = { title: "지원 관리 · 한끗" };

// 지원 관리 목록. 기준: Figma 지원 관리 · 목록(화이트 · 다크: I02 내 문의 목록 틀 — 본문 위 40 · 가운데 720 · 간격 28,
// 제목 32 ExtraBold + 오른쪽 [+ 지원서 쓰기](작은 주 버튼), 아래 '‹ 1 / 1 ›'(간격 16))
// · 기획 메모 지원 관리(들어오는 곳: S09 '지원 관리' 카드, 최근 작성순, 줄을 누르면 상세 4.2, 목록에는 자기소개서 본문 없음)
// · Swagger 4.3 지원서 목록(ApplicationListResponse, page 0부터 · size 10)
// · 사용자 결정(2026-10-29: 빈 목록이면 I02처럼 목록 상자 없이 페이지 표시만)

/** Swagger 4.3 page는 int32(0 이상) */
const MAX_PAGE = 2_147_483_647;
/** Swagger 4.3 size 기본값 */
const PAGE_SIZE = 10;

/** 주소의 page. 0 이상의 int32 정수가 아니면 0 */
function parsePage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0;
  const page = Number(value);
  return page <= MAX_PAGE ? page : 0;
}

async function Applications({ searchParams }: Pick<PageProps<"/applications">, "searchParams">) {
  await connection();
  const page = parsePage((await searchParams).page);
  const list = await getApplications(page, PAGE_SIZE);
  const totalPages = Math.max(1, list.page.totalPages);

  return (
    <>
      <ApplicationList items={list.content} page={page} />
      <ApplicationPager page={page} totalPages={totalPages} pathOf={applicationsPath} />
    </>
  );
}

export default function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  return (
    <main className="flex flex-1 flex-col">
      <SlideIn>
        <InquiryPage>
          <div className="flex w-full items-end justify-between gap-4">
            <InquiryHead title="지원 관리" />
            <Link
              href={applicationNewPath()}
              className={`px-[18px] ${inquiryButtonClass("primary", "sm")}`}
            >
              + 지원서 쓰기
            </Link>
          </div>
          {/* 4.3을 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
          <Suspense fallback={null}>
            <Applications searchParams={searchParams} />
          </Suspense>
        </InquiryPage>
      </SlideIn>
    </main>
  );
}
