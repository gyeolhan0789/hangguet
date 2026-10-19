import type { Metadata } from "next";

import { StreakIntro } from "@/components/streak/streak-intro";
import { introCopy, shouldPlayIntro } from "@/lib/home/intro";
import { getHome } from "@/lib/home/queries";
import { tierOf } from "@/lib/streak";
import { serverToday } from "@/lib/today";

import { HomeSkeleton } from "./_components/home-skeleton";
import { HomeView } from "./_components/home-view";

export const metadata: Metadata = { title: "홈 · 한끗" };

// S02 홈. 데이터를 받는 동안 loading.tsx(스켈레톤)가 보이고, 받은 뒤 그 위에 S02-1 인트로를 덮어서 내려보낸다.
// 'N일째 달성!'과 S02-L 레벨업은 면접을 마친 순간(StreakCelebration, S08 흐름)에 보여 준다 — 홈 진입에서는 띄우지 않는다.
export default async function HomePage() {
  const home = await getHome();
  const today = await serverToday();

  return (
    <>
      <HomeView home={home} today={today} />
      {shouldPlayIntro(home) && (
        <StreakIntro
          tier={tierOf(home.currentStreak)}
          copy={introCopy(home)}
          backdrop={<HomeSkeleton withHeader />}
        />
      )}
    </>
  );
}
