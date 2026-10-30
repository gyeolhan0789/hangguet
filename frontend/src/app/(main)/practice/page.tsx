import type { Metadata } from "next";
import { Suspense } from "react";

import { getApplications, parseApplicationId } from "@/lib/application/queries";

import { ApplicationSelect } from "./_components/application-select";

export const metadata: Metadata = { title: "지원서 선택 · 한끗" };

// S03 지원서 선택(연습 시작 1단계). 기준: Figma S03 지원서 선택(화이트 · 다크) · 기획 메모 S03 지원서 선택(기존 S03 지원서 입력을 대체)
// · Swagger 4.3 지원서 목록 · 사용자 결정(2026-10-29: size 20(최대)으로 한 번만 부르고 페이지 넘김 없음)
// 주소의 applicationId가 목록에 있으면 그 지원서를 골라 둔다(S04 [← 지원서 선택] · 지원서 쓰기 저장 뒤). added=1이면 막 저장한 지원서다.

/** Swagger 4.3 size 최대값 */
const SELECT_SIZE = 20;

async function Select({ searchParams }: Pick<PageProps<"/practice">, "searchParams">) {
  const params = await searchParams;
  const applicationId = parseApplicationId(params.applicationId);
  const list = await getApplications(0, SELECT_SIZE);
  const selected = list.content.some((item) => item.id === applicationId) ? applicationId : null;
  // 한 번 본 화면은 상태를 살려 다시 보여 주므로(cacheComponents), 골라 둘 지원서가 바뀌면 새로 그려 그 지원서를 고른다.
  // 같은 주소로 새로 들어올 때(push · replace)는 ApplicationSelect가 bfcacheId로 새로 그린다.
  return (
    <ApplicationSelect
      key={`${selected}-${params.added === "1"}`}
      applications={list.content}
      initialSelected={selected}
      added={selected !== null && params.added === "1"}
    />
  );
}

export default function PracticePage({ searchParams }: PageProps<"/practice">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* 4.3을 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
      <Suspense fallback={null}>
        <Select searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
