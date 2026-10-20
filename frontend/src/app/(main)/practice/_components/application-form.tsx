"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";

import { MaskIcon } from "@/components/mask-icon";
import { PracticeActionBar, PracticeNextButton } from "@/components/practice/practice-action-bar";
import { PracticeSteps } from "@/components/practice/practice-steps";
import { createApplication, updateApplication } from "@/lib/application/actions";
import {
  applicationSchema,
  COMPANY_NAME_MAX,
  COVER_LETTER_MAX,
  JOB_TITLE_MAX,
  type ApplicationValues,
} from "@/lib/application/schemas";
import { ROUTES } from "@/lib/routes";
import type { ApplicationResponse } from "@/types/api";

import { CoverLetterCounter } from "./cover-letter-counter";

// 기준: Figma S03 지원서 입력(18:2033) · 메모 S03(필수 3칸, 빈칸이면 [다음] 비활성)
// · 모션 메모 S03(입력칸 포커스: 테두리 주황 + 바깥 글로우 0.2s, 커서 깜빡임) · Swagger 4.1 지원서 작성
// · S04 [← 지원서 수정](Figma 18:2204) · Swagger 4.2 지원서 조회 · 4.4 지원서 수정

/** 서버가 돌려준 칸별 오류(VALIDATION_FAILED)의 react-hook-form 오류 type */
const SERVER_ERROR = "server";

// Figma Input(18:2085) · Input · Focus(18:2090: 박스 안쪽 2px 테두리 brand + drop-shadow 0 0 7px rgba(255,122,38,0.2))
// 테두리 1px + 안쪽 링 1px로 2px를 그려, 박스 크기와 글자 위치는 그대로 둔다.
const inputBox =
  "border bg-bg-sub text-text-1 caret-brand outline-none transition-[border-color,box-shadow] duration-200 focus:border-brand focus:ring-1 focus:ring-brand focus:ring-inset focus:shadow-[0_0_7px_rgba(255,122,38,0.2)]";
const invalidBox = "border-danger ring-1 ring-danger ring-inset";

function ApplicationField({
  label,
  htmlFor,
  aside,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  /** 라벨 줄 오른쪽(자기소개서 글자 수) */
  aside?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-start justify-between">
        <label
          htmlFor={htmlFor}
          className="text-sm leading-normal font-bold tracking-[-0.2px] text-text-2"
        >
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error && (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="text-[13px] leading-normal font-semibold text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * application이 있으면 S04 [← 지원서 수정]으로 다시 연 것이다: 그 지원서(4.2)로 칸을 채우고 [다음]은 4.4로 고친다.
 * 없으면 새 지원서를 4.1로 만든다. loading은 고칠 지원서를 불러오는 동안이다: 입력과 제출을 막는다.
 */
export function ApplicationForm({
  application,
  loading = false,
}: {
  application?: ApplicationResponse;
  loading?: boolean;
}) {
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<ApplicationValues>({
    resolver: zodResolver(applicationSchema),
    mode: "onChange",
    defaultValues: {
      companyName: application?.companyName ?? "",
      jobTitle: application?.jobTitle ?? "",
      coverLetter: application?.coverLetter ?? "",
    },
  });

  const coverLetter = useWatch({ control, name: "coverLetter" });

  // 빈칸은 [다음] 비활성으로만 알리고, 칸 아래 문구는 서버가 거절한 이유(VALIDATION_FAILED)만 보여 준다.
  const serverError = (name: keyof ApplicationValues) =>
    errors[name]?.type === SERVER_ERROR ? errors[name]?.message : undefined;

  const onSubmit = handleSubmit(async (values) => {
    if (loading) return;
    setFormError(undefined);
    const result = application
      ? await updateApplication(application.id, values)
      : await createApplication(values);
    for (const [field, text] of Object.entries(result.fieldErrors ?? {})) {
      setError(field as keyof ApplicationValues, { type: SERVER_ERROR, message: text });
    }
    if (result.formError) setFormError(result.formError);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center gap-8 px-4 pt-8 pb-10">
        <PracticeSteps current={1} />

        <div className="flex w-full max-w-[760px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
              어떤 면접을 준비하나요?
            </h1>
            <p className="text-[17px] leading-normal font-medium tracking-[-0.2px] text-text-2">
              지원서를 바탕으로 질문과 평가 기준을 만들어요
            </p>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <ApplicationField
              label="회사명"
              htmlFor="companyName"
              error={serverError("companyName")}
            >
              <input
                id="companyName"
                autoComplete="organization"
                maxLength={COMPANY_NAME_MAX}
                aria-invalid={!!serverError("companyName") || undefined}
                aria-describedby={serverError("companyName") ? "companyName-error" : undefined}
                className={`h-14 w-full rounded-xl px-4 text-base leading-normal font-semibold tracking-[-0.2px] ${inputBox} ${serverError("companyName") ? invalidBox : "border-line"}`}
                readOnly={loading}
                {...register("companyName")}
              />
            </ApplicationField>
            <ApplicationField label="직무" htmlFor="jobTitle" error={serverError("jobTitle")}>
              <input
                id="jobTitle"
                autoComplete="organization-title"
                maxLength={JOB_TITLE_MAX}
                aria-invalid={!!serverError("jobTitle") || undefined}
                aria-describedby={serverError("jobTitle") ? "jobTitle-error" : undefined}
                className={`h-14 w-full rounded-xl px-4 text-base leading-normal font-semibold tracking-[-0.2px] ${inputBox} ${serverError("jobTitle") ? invalidBox : "border-line"}`}
                readOnly={loading}
                {...register("jobTitle")}
              />
            </ApplicationField>
          </div>

          <ApplicationField
            label="자기소개서"
            htmlFor="coverLetter"
            error={serverError("coverLetter")}
            aside={
              <CoverLetterCounter
                id="coverLetter-count"
                length={coverLetter.length}
                max={COVER_LETTER_MAX}
              />
            }
          >
            <textarea
              id="coverLetter"
              maxLength={COVER_LETTER_MAX}
              aria-invalid={!!serverError("coverLetter") || undefined}
              aria-describedby={`coverLetter-count${serverError("coverLetter") ? " coverLetter-error" : ""}`}
              className={`h-60 w-full resize-none rounded-2xl p-5 text-base leading-[1.7] font-medium tracking-[-0.2px] ${inputBox} ${serverError("coverLetter") ? invalidBox : "border-line"}`}
              readOnly={loading}
              {...register("coverLetter")}
            />
          </ApplicationField>

          <p className="flex items-center gap-1.5 text-sm leading-normal font-medium tracking-[-0.2px] text-text-3">
            <MaskIcon src="/practice/icon-info.svg" size={16} className="bg-text-3" />
            자소서는 저장되지 않아요 · 면접할 때마다 새로 입력해요
          </p>

          <AnimatePresence initial={false}>
            {formError && (
              <motion.p
                key={formError}
                role="alert"
                className="text-sm leading-normal font-semibold text-danger"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, x: [-4, 4, -2, 2, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
              >
                {formError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      <PracticeActionBar backHref={ROUTES.home} backLabel="홈으로">
        <PracticeNextButton disabled={!isValid || loading} pending={isSubmitting}>
          다음: 면접관 선택
        </PracticeNextButton>
      </PracticeActionBar>
    </form>
  );
}
