import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { isDate } from "@/lib/date";
import { getSessionCalendar, getSessionList } from "@/lib/records/queries";
import { ROUTES } from "@/lib/routes";
import { serverToday } from "@/lib/today";
import { monthOf } from "@/lib/user/calendar";

import { DayCalendarCard } from "./_components/day-calendar-card";
import { InterviewList } from "./_components/interview-list";
import { RecordsSkeleton } from "./_components/records-skeleton";

export const metadata: Metadata = { title: "연습 기록 · 한끗" };

// 연습 기록. 기준: Figma 연습 기록 초안(232:843 화이트 · 241:871 다크 · 223:843 와이어프레임: 본문 위 32 · 좌우 160 · 간격 24
// — '연습 기록' + 전체 건수 → 왼쪽 날짜 · 달력 한 상자(360) · 오른쪽 면접 목록) · 메모 · 모션 메모 연습 기록
// · 웹 Swagger 5.15 월별 연습 면접 횟수(달력) · 5.13 연습 면접 목록(모두 한국 시간 면접 시작 날짜 기준)
// · 사용자 결정(2026-10-23: 들어오면 한국 시간 오늘, 날짜를 고르면 첫 페이지, 미래 날짜는 고르지 않음)
// 볼 날짜는 주소의 date, 페이지는 page(0부터)로 받는다. 날짜가 잘못됐거나 미래면 오늘로 보낸다.

/** Swagger 5.13 page는 int32(0 이상) */
const MAX_PAGE = 2_147_483_647;

/** 주소의 page. 0 이상의 int32 정수가 아니면 0 */
function parsePage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0;
  const page = Number(value);
  return page <= MAX_PAGE ? page : 0;
}

async function Records({ searchParams }: Readonly<Pick<PageProps<"/records">, "searchParams">>) {
  // 요청할 때마다 그린다(오늘 날짜 · 5.15 · 5.13은 미리 그려 둘 수 없다).
  await connection();
  const params = await searchParams;
  const today = await serverToday();
  if (params.date !== undefined && !(isDate(params.date) && params.date <= today)) {
    redirect(ROUTES.records);
  }
  const date = isDate(params.date) ? params.date : today;
  const page = parsePage(params.page);
  const [calendar, list] = await Promise.all([
    getSessionCalendar(monthOf(date)),
    getSessionList(date, page),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[1152px] flex-col gap-6 px-4 pt-8 pb-16">
      <div className="flex items-center gap-2.5">
        <h1 className="text-[28px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
          연습 기록
        </h1>
        <span className="rounded-full bg-surface px-2.5 py-1 text-[13px] leading-normal font-bold tracking-[-0.2px] text-text-3">
          전체 {list.summary.totalInterviewCount}회
        </span>
      </div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
        <DayCalendarCard
          date={date}
          today={today}
          interviewCount={list.page.totalElements}
          practicedDates={calendar.content
            .filter((day) => day.interviewCount > 0)
            .map((day) => day.practiceDate)}
        />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <InterviewList key={`${date}-${page}`} date={date} list={list} />
        </div>
      </div>
    </div>
  );
}

export default function RecordsPage({ searchParams }: PageProps<"/records">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<RecordsSkeleton />}>
        <Records searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
