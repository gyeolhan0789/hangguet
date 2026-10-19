import type { ReactNode } from "react";

import { MaskIcon } from "@/components/mask-icon";
import type { HomeResponse } from "@/types/api";
import { buildWeek } from "@/lib/home/week";
import { ROUTES } from "@/lib/routes";

import { FirstSteps } from "./first-steps";
import {
  EmptyRecentReviews,
  LastPracticeCard,
  NextActionCard,
  RecentReviewsCard,
  TodayImprovedCard,
} from "./home-cards";
import { HomeCta } from "./home-cta";
import { RemainingTime } from "./remaining-time";
import { StreakBadge } from "./streak-badge";
import { WeekRow } from "./week-row";

function Chip({
  icon,
  tone,
  children,
}: {
  icon: string;
  /** brand: 남은 시간(S02) · plain: 완료·최고 기록(S02-B · S02-C) */
  tone: "brand" | "plain";
  children: ReactNode;
}) {
  const brand = tone === "brand";
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[15px] leading-normal font-semibold ${
        brand ? "bg-brand-soft text-brand-ink dark:bg-brand-soft/8" : "bg-bg-sub text-text-2"
      }`}
    >
      <MaskIcon src={icon} size={16} className={brand ? "bg-brand-ink" : "bg-text-2"} />
      {children}
    </span>
  );
}

/** 뱃지 · '연속 연습' · N일째 · 한 줄 · 칩(첫 방문은 없음) */
function StreakHero({ days, message, chip }: { days: number; message: string; chip?: ReactNode }) {
  return (
    <section className="flex flex-col items-center gap-2 text-center">
      <StreakBadge days={days} />
      <p className="text-base leading-normal font-semibold text-text-3">연속 연습</p>
      <h1 className="text-[64px] leading-[1.15] font-extrabold tracking-[-2px] text-text-1 sm:text-[88px] sm:tracking-[-3px]">
        {days}일째
      </h1>
      <p className="text-lg leading-normal font-semibold text-text-1 sm:text-xl">{message}</p>
      {chip}
    </section>
  );
}

function Cards({ children }: { children: ReactNode }) {
  return (
    <div className="grid w-full max-w-[1120px] items-start gap-5 sm:grid-cols-2">{children}</div>
  );
}

/** S02 홈. homeState에 따라 S02(오늘 미완료) · S02-B(완료) · S02-C(끊김) · S02-D(첫 방문)를 그린다. */
export function HomeView({ home, today }: { home: HomeResponse; today: string }) {
  const week = buildWeek(home, today);
  const n = home.currentStreak;

  switch (home.homeState) {
    case "FIRST_VISIT":
      // Figma S02-D는 '첫 연습' 제목만 두지만, 끊김(S02-C)처럼 0일째를 보여 주고 아래 문구만 다르게 한다.
      return (
        <main className="flex flex-col items-center gap-[26px] px-6 pt-9 pb-16">
          <StreakHero days={0} message="첫 연습을 시작해볼까요?" />
          <WeekRow days={week} wave={false} />
          <HomeCta href={ROUTES.practice} label="첫 면접 시작하기" />
          <FirstSteps />
          <EmptyRecentReviews />
        </main>
      );

    case "DONE_TODAY":
      return (
        <main className="flex flex-col items-center gap-7 px-6 pt-9 pb-16">
          <StreakHero
            days={n}
            message="오늘 연습 완료! 내일 또 만나요"
            chip={
              <Chip icon="/home/icon-calendar-check.svg" tone="plain">
                내일 자정 전에 하면 {n + 1}일째
              </Chip>
            }
          />
          <WeekRow days={week} />
          <HomeCta
            href={ROUTES.practice}
            label="한 번 더 연습하기"
            caption={`오늘 면접 ${home.todayInterviewCount}회 · ${home.todayPracticeMinutes}분`}
            variant="secondary"
          />
          <Cards>
            <TodayImprovedCard home={home} today={today} />
            <RecentReviewsCard reviews={home.recentReviews} />
          </Cards>
        </main>
      );

    case "BROKEN":
      return (
        <main className="flex flex-col items-center gap-7 px-6 pt-9 pb-16">
          <StreakHero
            days={0}
            message="스트릭이 끊겼어요. 오늘 다시 1일째부터!"
            chip={
              <Chip icon="/home/icon-trophy.svg" tone="plain">
                지난 최고 기록 {home.bestStreak}일
              </Chip>
            }
          />
          <WeekRow days={week} />
          <HomeCta href={ROUTES.practice} label="다시 1일째 시작하기" />
          <Cards>
            <LastPracticeCard home={home} />
            <RecentReviewsCard reviews={home.recentReviews} />
          </Cards>
        </main>
      );

    case "NOT_DONE_TODAY":
      return (
        <main className="flex flex-col items-center gap-7 px-6 pt-9 pb-16">
          <StreakHero
            days={n}
            message="오늘도 불태워볼까요?"
            chip={
              <Chip icon="/home/icon-clock.svg" tone="brand">
                오늘 남은 시간 <RemainingTime />
              </Chip>
            }
          />
          <WeekRow days={week} />
          <HomeCta href={ROUTES.practice} label="오늘의 연습 시작하기" />
          <Cards>
            <NextActionCard home={home} />
            <RecentReviewsCard reviews={home.recentReviews} />
          </Cards>
        </main>
      );
  }
}
