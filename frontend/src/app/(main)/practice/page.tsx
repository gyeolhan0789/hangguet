import type { Metadata } from "next";
import { Suspense } from "react";

import { getApplication, parseApplicationId } from "@/lib/application/queries";

import { ApplicationForm } from "./_components/application-form";

export const metadata: Metadata = { title: "지원서 입력 · 한끗" };

// S03 지원서 입력(연습 시작 1단계). MVP는 지원서를 고르지 않고 면접할 때마다 새로 입력한다(Figma 메모 S03).
// S04 [← 지원서 수정]으로 오면 주소의 applicationId로 그 지원서(4.2)를 불러와 칸을 채운다.
async function EditableApplicationForm({
  searchParams,
}: Pick<PageProps<"/practice">, "searchParams">) {
  const applicationId = parseApplicationId((await searchParams).applicationId);
  const application = applicationId === null ? null : await getApplication(applicationId);
  return <ApplicationForm application={application ?? undefined} />;
}

export default function PracticePage({ searchParams }: PageProps<"/practice">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* 빈 폼을 먼저 보여 주고(입력 · 제출은 막음), 주소를 읽은 뒤 새로 쓰기 또는 채운 폼으로 바꾼다.
          불러오는 동안 제출을 막아, 고치려던 지원서 대신 새 지원서(4.1)가 만들어지지 않게 한다. */}
      <Suspense fallback={<ApplicationForm loading />}>
        <EditableApplicationForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
