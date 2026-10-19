import type { Metadata } from "next";

import { todayKst } from "@/lib/date";
import { shouldPlayIntro } from "@/lib/home/intro";
import { getHome } from "@/lib/home/queries";

import { HomeView } from "./_components/home-view";
import { StreakIntro } from "./_components/streak-intro";

export const metadata: Metadata = { title: "홈 · 한끗" };

// S02 홈. 데이터를 받는 동안 loading.tsx(스켈레톤)가 보이고, 받은 뒤 그 위에 S02-1 인트로를 덮어서 내려보낸다.
// S02-L 레벨업은 면접을 마치고 스트릭이 올랐을 때(S08 흐름) 보여 준다 — 홈 진입에서는 띄우지 않는다.
export default async function HomePage() {
  const home = await getHome();
  const today = todayKst();

  return (
    <>
      <HomeView home={home} today={today} />
      {shouldPlayIntro(home) && <StreakIntro home={home} />}
    </>
  );
}
