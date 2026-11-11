import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { inquiryButtonClass } from "@/components/inquiry/inquiry-button-class";
import { InquiryHead, InquiryPage, StatusChip } from "@/components/inquiry/inquiry-ui";
import { getMyInquiries } from "@/lib/inquiry/queries";
import { inquiriesPath, inquiryPath, ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "내 문의 · 한끗" };

// I02 내 문의 목록. 기준: Figma I02(화이트 · 다크) · 기획 메모 I02(회원만, 헤더 프로필 메뉴 '문의하기'로 진입, 최근 작성순,
// 한 줄 = 제목 · 상태 · 작성일, 줄을 누르면 I03, [+ 문의하기] → I01) · Swagger 9.2 내 문의 목록(InquiryListResponse, page 0부터 · size 10)
// · 목록 상자 bg-sub · 둥글기 20 · 좌우 24 · 위아래 4, 줄 위아래 18 · 줄 사이 1px line, 제목 16 SemiBold(종료는 text-3)
// · 작성일 13 Medium text-3(YYYY.MM.DD) · 오른쪽 상태 칩 + '›'(18 Medium text-3, 간격 12) · 아래 '‹ 1 / 1 ›'(간격 16)

/** Swagger 9.2 page는 int32(0 이상) */
const MAX_PAGE = 2_147_483_647;

/** 주소의 page. 0 이상의 int32 정수가 아니면 0 */
function parsePage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0;
  const page = Number(value);
  return page <= MAX_PAGE ? page : 0;
}

const pagerArrow = "text-lg leading-normal font-medium text-text-3";

async function Inquiries({
  searchParams,
}: Readonly<Pick<PageProps<"/inquiries">, "searchParams">>) {
  await connection();
  const page = parsePage((await searchParams).page);
  const list = await getMyInquiries(page);
  const totalPages = Math.max(1, list.page.totalPages);

  return (
    <>
      {list.content.length > 0 && (
        <ul
          aria-label="내 문의"
          className="flex w-full flex-col rounded-[20px] bg-bg-sub px-6 py-1"
        >
          {list.content.map((item) => (
            <li key={item.id} className="border-b border-line last:border-b-0">
              <Link
                href={inquiryPath(item.id)}
                className="flex items-center justify-between gap-3 py-[18px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span
                    className={`truncate text-base leading-normal font-semibold ${item.status === "CLOSED" ? "text-text-3" : "text-text-1"}`}
                  >
                    {item.title}
                  </span>
                  <span className="text-[13px] leading-normal font-medium text-text-3">
                    {item.createdAt.slice(0, 10).replaceAll("-", ".")}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <StatusChip status={item.status} />
                  <span aria-hidden className={pagerArrow}>
                    ›
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="페이지" className="flex w-full items-center justify-center gap-4">
        {page > 0 ? (
          <Link href={inquiriesPath(page - 1)} aria-label="이전 페이지" className={pagerArrow}>
            ‹
          </Link>
        ) : (
          <span aria-hidden className={pagerArrow}>
            ‹
          </span>
        )}
        <span className="text-[15px] leading-normal font-semibold text-text-2">
          {page + 1} / {totalPages}
        </span>
        {page + 1 < totalPages ? (
          <Link href={inquiriesPath(page + 1)} aria-label="다음 페이지" className={pagerArrow}>
            ›
          </Link>
        ) : (
          <span aria-hidden className={pagerArrow}>
            ›
          </span>
        )}
      </nav>
    </>
  );
}

export default function InquiriesPage({ searchParams }: PageProps<"/inquiries">) {
  return (
    <main className="flex flex-1 flex-col">
      <InquiryPage>
        <div className="flex w-full items-end justify-between gap-4">
          <InquiryHead title="내 문의" />
          <Link
            href={ROUTES.inquiryNew}
            className={`w-[120px] ${inquiryButtonClass("primary", "sm")}`}
          >
            + 문의하기
          </Link>
        </div>
        {/* 9.2를 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
        <Suspense fallback={null}>
          <Inquiries searchParams={searchParams} />
        </Suspense>
      </InquiryPage>
    </main>
  );
}
