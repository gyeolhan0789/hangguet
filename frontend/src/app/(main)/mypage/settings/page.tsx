import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getMe } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

import { SettingsView } from "./_components/settings-view";

export const metadata: Metadata = { title: "설정 · 한끗" };

// S09-1 설정. 기준: Figma S09-1(18:3157) · Swagger 2.1 내 정보(MeResponse)
async function Settings() {
  const me = await getMe();
  if (!me) redirect(ROUTES.login);
  return <SettingsView me={me} />;
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
