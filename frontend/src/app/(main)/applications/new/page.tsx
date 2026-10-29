import type { Metadata } from "next";
import { Suspense } from "react";

import type { ApplicationWriteFrom } from "@/lib/routes";

import { ApplicationWriteForm } from "./_components/application-write-form";

export const metadata: Metadata = { title: "지원서 쓰기 · 한끗" };

// 지원서 쓰기. 기준: Figma 지원서 쓰기(화이트 · 다크) · 기획 메모 지원서 쓰기(들어오는 곳: S03 [+ 추가하기] · 지원 관리 [+ 지원서 쓰기])
// · 사용자 결정(2026-10-29: 저장 뒤 · [← 뒤로]는 들어온 곳으로). 어디서 왔는지는 주소의 from(practice)으로 받는다.
async function WriteForm({ searchParams }: Pick<PageProps<"/applications/new">, "searchParams">) {
  const from: ApplicationWriteFrom =
    (await searchParams).from === "practice" ? "practice" : "applications";
  return <ApplicationWriteForm from={from} />;
}

export default function ApplicationNewPage({ searchParams }: PageProps<"/applications/new">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* 주소를 읽는 동안 보여 줄 화면은 Figma에 없다. */}
      <Suspense fallback={null}>
        <WriteForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
