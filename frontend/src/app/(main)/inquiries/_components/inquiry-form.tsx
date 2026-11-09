"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Field, SubmitButton, TextInput } from "@/components/form";
import { inquiryButtonClass } from "@/components/inquiry/inquiry-button-class";
import { TextArea } from "@/components/inquiry/inquiry-ui";
import { PhotoField, usePhotoPicks } from "@/components/inquiry/photo-picker";
import { createInquiry } from "@/lib/inquiry/actions";
import { uploadInquiryPhotos } from "@/lib/inquiry/upload-photos";
import { INQUIRY_TITLE_MAX, inquirySchema, type InquiryValues } from "@/lib/inquiry/schemas";
import { ROUTES } from "@/lib/routes";

// 기준: Figma I01 문의하기 · 회원(제목(카운터 'N / 100', 오른쪽 13 Medium text-3) · 내용(높이 220)
// · [취소](보조 120) [문의 보내기](주 160), 오른쪽 맞춤 간격 8)
// · 기획 메모 I01(제목 1~100자 · 내용 필수 → 9.1(201) → I03 그 문의, [취소] → I02) · Swagger 9.1 문의 작성(InquiryCreateRequest)
// · Swagger 9.11 → 9.1 attachmentKeys · 사용자 결정(2026-11-03: 내용 아래 '사진' 칸(photo-picker))
// 서버 칸 오류(VALIDATION_FAILED)는 그 칸 아래에, 그 밖의 실패(사진 올리기 실패 포함)는 버튼 아래에 서버 문구로 보여 준다.

/**
 * I01 문의하기. 한 번 본 화면은 입력값을 살려 다시 보여 주므로(cacheComponents · Activity), 보낸 뒤 다시 들어와도 지난 제목 ·
 * 내용 · 사진이 남지 않게 새로 들어올 때마다(push · replace) 새로 그리고, 뒤로 · 앞으로 가기로 돌아오면 그대로 둔다(Next useRouter().bfcacheId — 지원서 쓰기와 같은 방식).
 */
export function InquiryForm() {
  const { bfcacheId } = useRouter();
  return <Inquiry key={bfcacheId} />;
}

function Inquiry() {
  const [formError, setFormError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const picks = usePhotoPicks();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<InquiryValues>({
    resolver: zodResolver(inquirySchema),
    defaultValues: { title: "", content: "" },
  });
  const titleLength = useWatch({ control, name: "title" }).length;

  const submit = handleSubmit((values) => {
    setFormError(undefined);
    startTransition(async () => {
      const uploaded = await uploadInquiryPhotos(picks.files);
      if (!uploaded.keys) {
        setFormError(uploaded.error);
        return;
      }
      const result = await createInquiry(values, uploaded.keys);
      for (const [field, reason] of Object.entries(result.fieldErrors ?? {})) {
        setError(field as keyof InquiryValues, { message: reason });
      }
      if (result.formError) setFormError(result.formError);
    });
  });

  const titleMessage = errors.title?.message;
  const contentMessage = errors.content?.message;

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-7">
      <Field
        label="제목"
        htmlFor="title"
        variant="md"
        message={titleMessage ? { text: titleMessage, tone: "error" } : undefined}
        hint={
          <span className="text-right text-[13px] leading-normal font-medium text-text-3">
            {titleLength} / {INQUIRY_TITLE_MAX}
          </span>
        }
      >
        <TextInput
          id="title"
          variant="md"
          placeholder="예) 비밀번호를 잊어버렸어요"
          maxLength={INQUIRY_TITLE_MAX}
          invalid={!!titleMessage}
          {...register("title")}
        />
      </Field>
      <Field
        label="내용"
        htmlFor="content"
        variant="md"
        message={contentMessage ? { text: contentMessage, tone: "error" } : undefined}
      >
        <TextArea
          id="content"
          heightClass="h-[220px]"
          placeholder="궁금한 점이나 요청을 적어 주세요"
          invalid={!!contentMessage}
          {...register("content")}
        />
      </Field>
      <PhotoField picks={picks} disabled={pending} />
      <div className="flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <Link href={ROUTES.inquiries} className={`w-[120px] ${inquiryButtonClass("secondary")}`}>
            취소
          </Link>
          <div className="w-40">
            <SubmitButton pending={pending} pendingText="문의 보내기" height="h-[54px]">
              문의 보내기
            </SubmitButton>
          </div>
        </div>
        {formError && (
          <p role="alert" className="text-[13px] leading-normal font-semibold text-danger">
            {formError}
          </p>
        )}
      </div>
    </form>
  );
}
