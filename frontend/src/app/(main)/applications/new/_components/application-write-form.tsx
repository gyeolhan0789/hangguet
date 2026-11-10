"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type UseFormRegisterReturn,
} from "react-hook-form";

import { CoverLetterCounter } from "@/components/application/cover-letter-counter";
import { MaskIcon } from "@/components/mask-icon";
import { PracticeActionBar, PracticeNextButton } from "@/components/practice/practice-action-bar";
import { createApplication } from "@/lib/application/actions";
import {
  ANSWER_MAX,
  applicationSchema,
  COMPANY_NAME_MAX,
  COVER_LETTER_ITEMS_MAX,
  JOB_TITLE_MAX,
  QUESTION_MAX,
  type ApplicationValues,
} from "@/lib/application/schemas";
import { ROUTES, type ApplicationWriteFrom } from "@/lib/routes";
import type { CompanyItem } from "@/types/api";

import { CompanyCombobox } from "./company-combobox";

// 기준: Figma 지원서 쓰기(화이트 · 다크: S03 지원서 입력 틀에서 진행 단계를 뺀 화면 — 제목 32 ExtraBold · 설명 17 Medium text-2
// · 회사명 · 직무 입력(높이 56 · 둥글기 12) · 자기소개서 줄(14 Bold text-2) · 문항 상자(둥글기 16 · 패딩 20 ·
// 'Q1' 15 ExtraBold brand-ink + 문항 입력 · 구분선 · 답변 입력) · [+ 문항 추가](surface · 높이 56 · 둥글기 14 · 17 Bold)
// · 아래 막대 [← 뒤로] · [저장하기]) · 기획 메모 지원서 쓰기(첫 화면은 문항 1개, 문항이 1개면 ✕ 숨김,
// 400이면 자기소개서 아래 서버 문구 · 503이면 다시 시도 안내) · 모션 메모 지원서 쓰기(입력칸 포커스 · 글자 수는 S03과 같음,
// [+ 문항 추가]는 높이 0→auto 0.25s 후 문항 칸에 포커스, ✕는 높이 접힘 0.2s, 400 문구는 y 4→0 · opacity)
// · Swagger 4.1 지원서 작성(coverLetterItems 1~5개 · 문항 255자 · 답변 20,000자) · ERD cover_letter_items(지원서당 최대 5개)
// · 사용자 결정(2026-10-29: 빈 문항 · 답변이 있으면 [저장하기] 비활성, 저장 뒤 · [← 뒤로]는 들어온 곳으로, 글자 수는 문항마다
//   답변 20,000자 — 상자 오른쪽 아래에 그 문항의 글자 수를 보여 준다. Figma의 자기소개서 줄 합계 '0 / 3,000'은 문항별로 바뀌어 뺐다)
// · 문항이 5개면 [+ 문항 추가]를 숨긴다(문항이 1개면 ✕를 숨기는 기획 메모와 같은 방식)
// · 회사명은 4.7 회사 목록으로 자동 완성한다(company-combobox)

/** 서버가 돌려준 칸별 오류(VALIDATION_FAILED)의 react-hook-form 오류 type */
const SERVER_ERROR = "server";

// Figma Input · Input · Focus(S03: 박스 안쪽 2px 테두리 brand + drop-shadow 0 0 7px rgba(255,122,38,0.2))
// 테두리 1px + 안쪽 링 1px로 2px를 그려, 박스 크기와 글자 위치는 그대로 둔다.
const inputBox =
  "border bg-bg-sub text-text-1 caret-brand outline-none transition-[border-color,box-shadow] duration-200 focus:border-brand focus:ring-1 focus:ring-brand focus:ring-inset focus:shadow-[0_0_7px_rgba(255,122,38,0.2)]";
/** 문항 상자: 안의 문항 · 답변 칸에 포커스가 있으면 상자 테두리가 입력칸 포커스와 같아진다 */
const questionBox =
  "border bg-bg-sub transition-[border-color,box-shadow] duration-200 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand focus-within:ring-inset focus-within:shadow-[0_0_7px_rgba(255,122,38,0.2)]";
const invalidBox = "border-danger ring-1 ring-danger ring-inset";

const EMPTY_ITEM = { question: "", answer: "" };
const DEFAULT_VALUES: ApplicationValues = {
  companyName: "",
  jobTitle: "",
  coverLetterItems: [EMPTY_ITEM],
};

function Field({
  label,
  htmlFor,
  error,
  children,
}: Readonly<{
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
}>) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <label
        htmlFor={htmlFor}
        className="text-sm leading-normal font-bold tracking-[-0.2px] text-text-2"
      >
        {label}
      </label>
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
 * 문항 하나의 답변 칸과 그 글자 수. 글자 수 id는 useId로 만들어, 문항을 빼는 동안(사라지는 상자 · 당겨진 상자) 겹치지 않고
 * 서버 · 브라우저에서 같다.
 */
function AnswerField({
  index,
  length,
  registration,
}: Readonly<{
  index: number;
  length: number;
  registration: UseFormRegisterReturn;
}>) {
  const countId = `${useId()}-count`;
  return (
    <>
      <textarea
        aria-label={`문항 ${index + 1} 답변`}
        aria-describedby={countId}
        placeholder="답변을 입력해 주세요"
        maxLength={ANSWER_MAX}
        className="h-36 w-full resize-none bg-transparent text-base leading-[1.7] font-medium tracking-[-0.2px] text-text-1 caret-brand outline-none placeholder:text-text-3"
        {...registration}
      />
      <div className="flex justify-end">
        <CoverLetterCounter id={countId} length={length} max={ANSWER_MAX} />
      </div>
    </>
  );
}

/**
 * 지원서 쓰기. 한 번 본 화면은 입력값을 살려 다시 보여 주므로(cacheComponents · Activity), 새로 들어올 때마다(push · replace)
 * 폼을 새로 그려 처음부터 쓰게 한다. 뒤로 · 앞으로 가기로 돌아오면 쓰던 내용을 그대로 둔다(Next useRouter().bfcacheId).
 * 떠날 때 reset()으로 비우면 돌아왔을 때 지난 문항 상자가 사라지는 연출이 새 상자와 겹쳐 보여, 새로 그리는 쪽을 쓴다.
 */
export function ApplicationWriteForm({
  from,
  companies = [],
}: Readonly<{
  from: ApplicationWriteFrom;
  /** 4.7 회사 목록. 비어 있으면 회사명은 일반 입력칸이다 */
  companies?: CompanyItem[];
}>) {
  const { bfcacheId } = useRouter();
  return <WriteForm key={bfcacheId} from={from} companies={companies} />;
}

function WriteForm({
  from,
  companies,
}: Readonly<{ from: ApplicationWriteFrom; companies: CompanyItem[] }>) {
  const reduce = useReducedMotion();
  const [formError, setFormError] = useState<string>();
  // 자기소개서 거절 문구. setError(root)는 isValid를 false로 만들어 같은 내용으로 다시 저장할 수 없게 하므로 따로 둔다.
  const [coverLetterError, setCoverLetterError] = useState<string>();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<ApplicationValues>({
    resolver: zodResolver(applicationSchema),
    mode: "onChange",
    defaultValues: DEFAULT_VALUES,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "coverLetterItems" });
  const addButton = useRef<HTMLButtonElement | null>(null);
  // 문항이 5개일 때 ✕를 누르면 [+ 문항 추가]가 그 뒤에 다시 그려지므로, 그려질 때 포커스를 옮긴다.
  const focusAddOnMount = useRef(false);
  const addButtonRef = useCallback((button: HTMLButtonElement | null) => {
    addButton.current = button;
    if (button && focusAddOnMount.current) {
      focusAddOnMount.current = false;
      button.focus();
    }
  }, []);

  const items = useWatch({ control, name: "coverLetterItems" });

  // 빈칸은 [저장하기] 비활성으로만 알리고, 칸 아래 문구는 서버가 거절한 이유만 보여 준다.
  const companyError =
    errors.companyName?.type === SERVER_ERROR ? errors.companyName.message : undefined;
  const jobError = errors.jobTitle?.type === SERVER_ERROR ? errors.jobTitle.message : undefined;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);
    setCoverLetterError(undefined);
    const result = await createApplication(values, from);
    const fieldErrors = result.fieldErrors ?? {};
    if (fieldErrors.companyName) {
      setError("companyName", { type: SERVER_ERROR, message: fieldErrors.companyName });
    }
    if (fieldErrors.jobTitle) {
      setError("jobTitle", { type: SERVER_ERROR, message: fieldErrors.jobTitle });
    }
    // 질문을 만들기 어려운 자기소개서(coverLetterItems)는 문항 하나에 걸지 않고 자기소개서 아래에 보여 준다.
    if (fieldErrors.coverLetterItems) setCoverLetterError(fieldErrors.coverLetterItems);
    if (result.formError) setFormError(result.formError);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center px-4 pt-8 pb-10">
        <div className="flex w-full max-w-[760px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
              지원서 쓰기
            </h1>
            <p className="text-[17px] leading-normal font-medium tracking-[-0.2px] text-text-2">
              저장한 지원서는 여러 면접에 쓸 수 있어요
            </p>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <Field label="회사명" htmlFor="companyName" error={companyError}>
              <Controller
                control={control}
                name="companyName"
                render={({ field: { onChange, ...field } }) => (
                  <CompanyCombobox
                    {...field}
                    companies={companies}
                    onValueChange={onChange}
                    id="companyName"
                    autoComplete="organization"
                    placeholder="예) ○○전자"
                    maxLength={COMPANY_NAME_MAX}
                    aria-invalid={!!companyError || undefined}
                    aria-describedby={companyError ? "companyName-error" : undefined}
                    className={`h-14 w-full rounded-xl px-4 text-base leading-normal font-semibold tracking-[-0.2px] placeholder:text-text-3 ${inputBox} ${companyError ? invalidBox : "border-line"}`}
                  />
                )}
              />
            </Field>
            <Field label="직무" htmlFor="jobTitle" error={jobError}>
              <input
                id="jobTitle"
                autoComplete="organization-title"
                placeholder="예) 백엔드 개발자"
                maxLength={JOB_TITLE_MAX}
                aria-invalid={!!jobError || undefined}
                aria-describedby={jobError ? "jobTitle-error" : undefined}
                className={`h-14 w-full rounded-xl px-4 text-base leading-normal font-semibold tracking-[-0.2px] placeholder:text-text-3 ${inputBox} ${jobError ? invalidBox : "border-line"}`}
                {...register("jobTitle")}
              />
            </Field>
          </div>

          <fieldset
            aria-describedby={coverLetterError ? "coverLetter-error" : undefined}
            className="flex min-w-0 flex-col gap-2"
          >
            <legend className="mb-2 text-sm leading-normal font-bold tracking-[-0.2px] text-text-2">
              자기소개서
            </legend>
            {/* 상자 사이 간격 8은 각 상자 아래 여백(pb-2)으로 두고, 마지막 상자 아래는 묶음 간격(gap-2)과 겹치지 않게 뺀다. */}
            <ol className="-mb-2 flex flex-col">
              <AnimatePresence initial={false}>
                {fields.map((field, i) => (
                  <motion.li
                    key={field.id}
                    layout={!reduce}
                    className="overflow-hidden"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{
                      height: "auto",
                      opacity: 1,
                      transition: { duration: reduce ? 0 : 0.25 },
                    }}
                    exit={{ height: 0, opacity: 0, transition: { duration: reduce ? 0 : 0.2 } }}
                  >
                    <div className="pb-2">
                      <div
                        className={`flex flex-col gap-3.5 rounded-2xl border-line p-5 ${questionBox}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className="shrink-0 text-[15px] leading-normal font-extrabold tracking-[-0.2px] text-brand-ink"
                          >
                            Q{i + 1}
                          </span>
                          <input
                            aria-label={`문항 ${i + 1}`}
                            placeholder="문항을 입력해 주세요   예) 지원 동기"
                            maxLength={QUESTION_MAX}
                            className="min-w-0 flex-1 bg-transparent text-base leading-[1.7] font-semibold tracking-[-0.2px] text-text-1 caret-brand outline-none placeholder:font-medium placeholder:text-text-3"
                            {...register(`coverLetterItems.${i}.question`)}
                          />
                          {fields.length > 1 && (
                            <button
                              type="button"
                              aria-label={`문항 ${i + 1} 빼기`}
                              onClick={() => {
                                remove(i);
                                // 누른 ✕가 사라지므로 포커스를 [+ 문항 추가]로 옮겨 키보드 · 화면 낭독기 위치를 잃지 않게 한다.
                                if (addButton.current) addButton.current.focus();
                                else focusAddOnMount.current = true;
                              }}
                              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-brand"
                            >
                              <MaskIcon src="/home/icon-x.svg" size={18} className="bg-text-3" />
                            </button>
                          )}
                        </div>
                        <div aria-hidden className="h-px bg-line" />
                        <AnswerField
                          index={i}
                          length={items[i]?.answer.length ?? 0}
                          registration={register(`coverLetterItems.${i}.answer`)}
                        />
                      </div>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
            {fields.length < COVER_LETTER_ITEMS_MAX && (
              <button
                ref={addButtonRef}
                type="button"
                onClick={() =>
                  append(EMPTY_ITEM, { focusName: `coverLetterItems.${fields.length}.question` })
                }
                className="flex h-14 w-full cursor-pointer items-center justify-center rounded-[14px] bg-surface text-[17px] leading-normal font-bold tracking-[-0.2px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                + 문항 추가
              </button>
            )}
            <AnimatePresence initial={false}>
              {coverLetterError && (
                <motion.p
                  key={coverLetterError}
                  id="coverLetter-error"
                  role="alert"
                  className="text-[13px] leading-normal font-semibold text-danger"
                  initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {coverLetterError}
                </motion.p>
              )}
            </AnimatePresence>
          </fieldset>

          <AnimatePresence initial={false}>
            {formError && (
              <motion.p
                key={formError}
                role="alert"
                className="text-sm leading-normal font-semibold text-danger"
                initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {formError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      <PracticeActionBar
        backHref={from === "practice" ? ROUTES.practice : ROUTES.applications}
        backLabel="뒤로"
      >
        <PracticeNextButton disabled={!isValid} pending={isSubmitting} arrow={false}>
          저장하기
        </PracticeNextButton>
      </PracticeActionBar>
    </form>
  );
}
