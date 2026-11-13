import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getApplications, parseApplicationId } from "@/lib/application/queries";
import { parseMode } from "@/lib/interview/modes";
import { parsePersona } from "@/lib/interview/personas";
import { interviewerPath, modePath, ROUTES } from "@/lib/routes";

import { GroupCreateForm } from "./_components/group-create-form";

export const metadata: Metadata = { title: "그룹 만들기 · 한끗" };

/** Swagger 4.3 size 최대값(S03과 같이 한 번만 부른다) */
const SELECT_SIZE = 20;

// G02 그룹 만들기(다대일 면접). 기준: Figma [초안] G02(484:2318) · BE Swagger 10.1 · 4.3 지원서 목록
// 면접관 · 방식은 S04 · S05-1에서 이미 골랐으므로 다시 묻지 않고 주소로 받은 값을 쓴다(사용자 결정 2026-11-13).
// 지원서가 목록에 없으면 처음 단계(S03)로, 면접관 · 방식이 없으면 그 단계로 보낸다.
async function Create({ searchParams }: Readonly<Pick<PageProps<"/groups/new">, "searchParams">>) {
  const params = await searchParams;
  const applicationId = parseApplicationId(params.applicationId);
  const list = await getApplications(0, SELECT_SIZE);
  if (!list.content.some((item) => item.id === applicationId)) redirect(ROUTES.practice);
  const persona = parsePersona(params.persona);
  if (!persona) redirect(interviewerPath(applicationId!));
  const mode = parseMode(params.mode);
  if (!mode) redirect(modePath(applicationId!, persona));
  return (
    <GroupCreateForm
      applications={list.content}
      initial={{ applicationId: applicationId!, persona, mode }}
    />
  );
}

export default function GroupNewPage({ searchParams }: PageProps<"/groups/new">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* 4.3을 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
      <Suspense fallback={null}>
        <Create searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
