import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getMe } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";
import { serverToday } from "@/lib/today";
import { monthOf, parseMonth } from "@/lib/user/calendar";
import { getPracticeLogs, getStats } from "@/lib/user/queries";

import { Toast } from "@/components/toast";

import { AchievementsCard, ApplicationCard } from "./_components/coming-soon";
import { MypageSkeleton } from "./_components/mypage-skeleton";
import { ProfileSection } from "./_components/profile-section";
import { StatTiles } from "./_components/stat-tiles";
import { StreakCalendar } from "./_components/streak-calendar";

export const metadata: Metadata = { title: "마이페이지 · 한끗" };

// S09 마이페이지. 기준: Figma S09(18:2848: 본문 위 32 · 좌우 160 · 간격 22 — 프로필 → '통계' → 통계 타일 4개 → 스트릭 달력 · 업적
// → 지원 관리) · Swagger 2.1 내 정보 · 3.2 통계 · 3.3 연습 달력(month=YYYY-MM) · 기획 메모 S09(18:1173)
// 달력에서 볼 달은 주소의 month로 받고, 없으면 이번 달(한국 시간)을 보여 준다.
async function Mypage({ searchParams }: Pick<PageProps<"/mypage">, "searchParams">) {
  const params = await searchParams;
  const today = await serverToday();
  const month = parseMonth(params.month) ?? monthOf(today);
  const [me, stats, logs] = await Promise.all([getMe(), getStats(), getPracticeLogs(month)]);
  if (!me) redirect(ROUTES.login);

  return (
    <>
      <div className="mx-auto flex w-full max-w-[1152px] flex-col gap-[22px] px-4 pt-8 pb-10">
        <ProfileSection me={me} stats={stats} />
        <h2 className="text-xl leading-normal font-extrabold tracking-[-0.2px] text-text-1">
          통계
        </h2>
        <StatTiles stats={stats} />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <StreakCalendar
            month={month}
            practicedDates={logs.content.map((log) => log.practiceDate)}
            today={today}
            currentStreak={stats.currentStreak}
          />
          <AchievementsCard />
        </div>
        <ApplicationCard />
      </div>
      <Toast />
    </>
  );
}

export default function MypagePage({ searchParams }: PageProps<"/mypage">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<MypageSkeleton />}>
        <Mypage searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
