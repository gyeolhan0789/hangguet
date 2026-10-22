import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getMe } from "@/lib/auth/session";
import { getGrowthReview } from "@/lib/growth/queries";
import { ROUTES } from "@/lib/routes";
import { serverToday } from "@/lib/today";

import { ReviewView } from "./_components/review-view";

export const metadata: Metadata = { title: "성장 리뷰 · 한끗" };

// S08 오늘의 성장 리뷰 · S08-B 설문 유도 · S08-C 첫 면접. 기준: Figma S08(18:2710) · S08-B(18:4578) · S08-C(18:4720)
// · Swagger 7.1 날짜별 성장 리뷰(404 GROWTH_REVIEW_NOT_FOUND: 그날 연습 기록 또는 결과가 없음)
// · API 명세 7.1(화면 — S08(오늘), S08-C(첫 면접), S09 달력 날짜, S02 최근 리뷰 [보기])
// · 사용자 결정(2026-10-22: 그날 리뷰가 없거나 주소의 날짜가 잘못됐으면 홈으로)

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 주소의 YYYY-MM-DD가 실제 있는 날짜인지 */
function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function Review({
  params,
  searchParams,
}: Pick<PageProps<"/reviews/[practiceDate]">, "params" | "searchParams">) {
  // 요청할 때마다 그린다(오늘 날짜 · 7.1은 미리 그려 둘 수 없다).
  await connection();
  const [{ practiceDate }, query] = await Promise.all([params, searchParams]);
  if (!isDate(practiceDate)) redirect(ROUTES.home);
  const [review, today, me] = await Promise.all([
    getGrowthReview(practiceDate),
    serverToday(),
    getMe(),
  ]);
  if (!review) redirect(ROUTES.home);

  return (
    <ReviewView
      key={practiceDate}
      review={review}
      today={review.practiceDate === today}
      fromResult={query.from === "result"}
      surveyUrl={process.env.NEXT_PUBLIC_SURVEY_URL || null}
      userId={me?.id ?? null}
    />
  );
}

export default function ReviewPage({ params, searchParams }: PageProps<"/reviews/[practiceDate]">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* 7.1을 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
      <Suspense fallback={null}>
        <Review params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
