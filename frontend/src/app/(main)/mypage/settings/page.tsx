import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { NOTICE_COOKIE, readNotice } from "@/lib/auth/kakao";
import { getMe } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";
import { getPracticeAlarm } from "@/lib/user/queries";

import { SettingsView } from "./_components/settings-view";

export const metadata: Metadata = { title: "설정 · 한끗" };

// S09-1 설정. 기준: Figma S09-1(18:3157) · S09-1-B(436:2104) · Swagger 2.1 내 정보(MeResponse) · 2.8 연습 알림 설정
// · 기획 메모 S09-1-B(428:2146: 알림 켜기 실패는 S09-1-B로 돌아와 토스트, 토글은 그대로)
async function Settings() {
  const me = await getMe();
  if (!me) redirect(ROUTES.login);
  const [alarm, store] = await Promise.all([getPracticeAlarm(), cookies()]);
  const notice = readNotice(store.get(NOTICE_COOKIE)?.value, "settings") ?? undefined;
  return <SettingsView me={me} alarm={alarm} notice={notice} />;
}

/** 내 정보(2.1)를 불러오는 동안. Figma에 로딩 화면이 없어 같은 자리에 회색 덩어리(S02 Home Skeleton 색)를 둔다. */
function SettingsSkeleton() {
  return (
    <div aria-hidden className="mx-auto flex w-full max-w-[752px] flex-col gap-7 px-4 pt-10">
      <div className="flex flex-col gap-2">
        <span className="h-[22px] w-24 rounded-[10px] bg-surface" />
        <span className="h-[42px] w-20 rounded-[10px] bg-surface" />
      </div>
      <span className="h-[340px] rounded-[20px] bg-surface" />
      <span className="h-[170px] rounded-[20px] bg-surface" />
      <span className="h-[70px] rounded-[20px] bg-surface" />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<SettingsSkeleton />}>
        <Settings />
      </Suspense>
    </main>
  );
}
