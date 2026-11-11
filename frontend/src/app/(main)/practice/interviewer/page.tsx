import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getApplication, parseApplicationId } from "@/lib/application/queries";
import { parsePersona } from "@/lib/interview/personas";
import { ROUTES } from "@/lib/routes";

import { InterviewerForm } from "./_components/interviewer-form";
import { InterviewerSkeleton } from "./_components/interviewer-skeleton";

export const metadata: Metadata = { title: "면접관 선택 · 한끗" };

// S04 면접관 선택(연습 시작 2단계). 기준: Figma S04(18:2122) · Swagger 4.2 지원서 조회
// 지원서가 없으면(주소가 틀렸거나 404) 처음 단계인 S03으로 돌려보낸다.
async function Interviewer({
  searchParams,
}: Readonly<Pick<PageProps<"/practice/interviewer">, "searchParams">>) {
  const params = await searchParams;
  const applicationId = parseApplicationId(params.applicationId);
  const application = applicationId === null ? null : await getApplication(applicationId);
  if (!application) redirect(ROUTES.practice);

  return (
    <InterviewerForm
      application={{
        id: application.id,
        companyName: application.companyName,
        jobTitle: application.jobTitle,
      }}
      initialPersona={parsePersona(params.persona)}
    />
  );
}

export default function InterviewerPage({ searchParams }: PageProps<"/practice/interviewer">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<InterviewerSkeleton />}>
        <Interviewer searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
