import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getApplication, parseApplicationId } from "@/lib/application/queries";
import { parsePersona, PERSONAS } from "@/lib/interview/personas";
import { interviewerPath, ROUTES } from "@/lib/routes";

import { ModeForm } from "./_components/mode-form";
import { ModeSkeleton } from "./_components/mode-skeleton";

export const metadata: Metadata = { title: "면접 방식 선택 · 한끗" };

// S05-1 면접 방식 선택(연습 시작 3단계). 기준: Figma S05-1(18:2219) · Swagger 4.2 지원서 조회
// 지원서가 없으면 S03으로, 면접관을 고르지 않았으면 S04로 돌려보낸다.
async function Mode({ searchParams }: Readonly<Pick<PageProps<"/practice/mode">, "searchParams">>) {
  const params = await searchParams;
  const applicationId = parseApplicationId(params.applicationId);
  const application = applicationId === null ? null : await getApplication(applicationId);
  if (!application) redirect(ROUTES.practice);
  const persona = parsePersona(params.persona);
  if (!persona) redirect(interviewerPath(application.id));

  const personaName = PERSONAS.find((info) => info.persona === persona)?.name;
  return (
    <ModeForm
      // 지원서 · 면접관이 바뀌면 폼을 새로 그려 5.1 멱등 키도 새로 만든다(같은 키 · 다른 본문 = 409).
      key={`${application.id}:${persona}`}
      applicationId={application.id}
      persona={persona}
      subtitle={`${personaName} · ${application.companyName} ${application.jobTitle}`}
    />
  );
}

export default function ModePage({ searchParams }: PageProps<"/practice/mode">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<ModeSkeleton />}>
        <Mode searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
