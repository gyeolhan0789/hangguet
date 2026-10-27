"use client";

import Form from "next/form";
import { useState } from "react";

import { PracticeActionBar, PracticeNextButton } from "@/components/practice/practice-action-bar";
import { PracticeSteps } from "@/components/practice/practice-steps";
import { applicationEditPath, ROUTES } from "@/lib/routes";
import type { ApplicationResponse, Persona } from "@/types/api";

import { PersonaList } from "./persona-list";

// 기준: Figma S04 면접관 선택(18:2122: 제목 · 지원서 줄 · 면접관 목록 · [← 지원서 수정] · [다음: 면접 방식])
// · Swagger 4.2(지원서 회사명 · 직무) · 5.1 SessionCreateRequest.persona
// 면접은 면접 방식(S05-1)까지 고른 뒤 만들므로(5.1), 여기서는 고른 면접관을 주소로 넘긴다(GET 폼).

export function InterviewerForm({
  application,
  initialPersona,
}: {
  /** 화면에 쓰는 칸만 받는다(자기소개서 본문은 브라우저로 보내지 않는다). */
  application: Pick<ApplicationResponse, "id" | "companyName" | "jobTitle">;
  /** 다음 단계에서 돌아왔을 때 이미 고른 면접관 */
  initialPersona: Persona | null;
}) {
  const [persona, setPersona] = useState<Persona | null>(initialPersona);

  return (
    <Form action={ROUTES.practiceMode} className="flex flex-1 flex-col">
      <input type="hidden" name="applicationId" value={application.id} />
      <div className="flex flex-1 flex-col items-center gap-8 px-4 pt-8 pb-10">
        <PracticeSteps current={2} />

        <div className="flex w-full max-w-[760px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
              오늘은 누구와 면접할까요?
            </h1>
            <p className="text-[17px] leading-normal font-medium tracking-[-0.2px] text-text-2">
              {application.companyName} · {application.jobTitle} 면접
            </p>
          </div>

          <PersonaList selected={persona} onSelect={setPersona} />
        </div>
      </div>

      <PracticeActionBar backHref={applicationEditPath(application.id)} backLabel="지원서 수정">
        <PracticeNextButton disabled={persona === null}>다음: 면접 방식</PracticeNextButton>
      </PracticeActionBar>
    </Form>
  );
}
