import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { getCompanies } from "@/lib/application/companies";
import type { ApplicationWriteFrom } from "@/lib/routes";
import type { CompanyItem } from "@/types/api";

import { ApplicationWriteForm } from "./_components/application-write-form";

export const metadata: Metadata = { title: "지원서 쓰기 · 한끗" };

// 지원서 쓰기. 기준: Figma 지원서 쓰기(화이트 · 다크) · 기획 메모 지원서 쓰기(들어오는 곳: S03 [+ 추가하기] · 지원 관리 [+ 지원서 쓰기])
// · 사용자 결정(2026-10-29: 저장 뒤 · [← 뒤로]는 들어온 곳으로). 어디서 왔는지는 주소의 from(practice)으로 받는다.
// · Swagger 4.7 회사 목록 · 사용자 결정(2026-11-03: 회사 목록을 못 불러오면 회사명은 일반 입력칸으로 쓴다)
async function loadCompanies(): Promise<CompanyItem[]> {
  try {
    return await getCompanies();
  } catch (error) {
    // 재발급 · 로그아웃 이동, 요청마다 그려야 한다는 Next 신호는 Next가 처리하도록 다시 던진다.
    unstable_rethrow(error);
    // 회사명은 직접 쓸 수 있어 목록 없이 그린다. 원인은 서버 로그에 남긴다.
    console.error("지원서 쓰기: 회사 목록(4.7)을 불러오지 못했어요.", error);
    return [];
  }
}

async function WriteForm({ searchParams }: Pick<PageProps<"/applications/new">, "searchParams">) {
  const [params, companies] = await Promise.all([searchParams, loadCompanies()]);
  const from: ApplicationWriteFrom = params.from === "practice" ? "practice" : "applications";
  return <ApplicationWriteForm from={from} companies={companies} />;
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
