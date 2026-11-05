"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Checkbox, Field, SubmitButton, TextInput } from "@/components/form";
import { inquiryButtonClass } from "@/components/inquiry/inquiry-button-class";
import { InquiryButton, InquiryModal, TextArea } from "@/components/inquiry/inquiry-ui";
import { PhotoField, usePhotoPicks } from "@/components/inquiry/photo-picker";
import { LegalModal } from "@/components/legal/legal-modal";
import { LegalViewButton } from "@/components/legal/legal-view-button";
import { createGuestInquiry } from "@/lib/inquiry/actions";
import { uploadInquiryPhotos } from "@/lib/inquiry/upload-photos";
import {
  INQUIRY_TITLE_MAX,
  guestInquiryFormSchema,
  type GuestInquiryFormValues,
  type GuestInquiryValues,
} from "@/lib/inquiry/schemas";
import { GUEST_INQUIRY_CONSENT } from "@/lib/legal/documents";
import { ROUTES } from "@/lib/routes";
import { useGuestInquiryStore } from "@/stores/guest-inquiry-store";

// 기준: Figma I01-B 문의하기 · 비회원(이메일 | 조회 비밀번호(아래 '문의번호와 함께 답변을 확인할 때 써요') 한 줄, 간격 16
// → 제목(카운터) → 내용(높이 160) → [취소](보조 120) [문의 보내기](주 160))
// · Figma I01-1 문의 접수 완료(모달 480 · 가운데 맞춤: '문의를 남겼어요' 24 Bold · '문의번호' 14 SemiBold text-3
// · 번호 56 ExtraBold brand-strong · 안내 15 Medium text-2 · [확인](주 버튼, 모달 너비))
// · 기획 메모 I01-B(이메일 형식 · 조회 비밀번호 4~20자 · 제목 1~100자 · 내용 필수 → 9.1(201) → I01-1, [취소] → I04)
// · 기획 메모 I01-1(9.1 응답 id를 문의번호로, [확인] → I03 그 문의(방금 정한 조회 비밀번호로 9.3)) · Swagger 9.1(InquiryCreateRequest)
// · 사용자 결정(2026-10-30: 비회원 문의에 [필수] 개인정보 수집 · 이용 동의를 더한다. Figma에 없어 가입 화면(S01-1)의 동의 줄 모양을 따른다)
// · Swagger 9.11 → 9.1 attachmentKeys · 사용자 결정(2026-11-03: 내용 아래 '사진' 칸(photo-picker), 비회원도 붙인다)

/**
 * I01-B 비회원 문의하기. 한 번 본 화면은 상태를 살려 다시 보여 주므로(cacheComponents · Activity), 문의를 남긴 뒤 다시 들어와도
 * 지난 완료 모달 · 입력값이 남지 않게 새로 들어올 때마다(push · replace) 새로 그리고, 뒤로 · 앞으로 가기로 돌아오면 그대로 둔다(Next useRouter().bfcacheId — 지원서 쓰기와 같은 방식).
 */
export function GuestInquiryForm() {
  const { bfcacheId } = useRouter();
  return <GuestInquiry key={bfcacheId} />;
}

function GuestInquiry() {
  const router = useRouter();
  const openStored = useGuestInquiryStore((s) => s.open);
  const [created, setCreated] = useState<{ inquiryId: number; accessPassword: string } | null>(
    null,
  );
  const [formError, setFormError] = useState<string>();
  const [viewingConsent, setViewingConsent] = useState(false);
  const [pending, startTransition] = useTransition();
  const picks = usePhotoPicks();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<GuestInquiryFormValues>({
    resolver: zodResolver(guestInquiryFormSchema),
    defaultValues: { email: "", accessPassword: "", title: "", content: "", agreed: false },
  });
  const titleLength = useWatch({ control, name: "title" }).length;
  const agreed = useWatch({ control, name: "agreed" });

  const submit = handleSubmit(({ email, accessPassword, title, content }) => {
    setFormError(undefined);
    // 동의(agreed)는 9.1이 받지 않으므로 보내지 않는다.
    const values: GuestInquiryValues = { email, accessPassword, title, content };
    startTransition(async () => {
      const uploaded = await uploadInquiryPhotos(picks.files);
      if (!uploaded.keys) {
        setFormError(uploaded.error);
        return;
      }
      const result = await createGuestInquiry(values, uploaded.keys);
      if (result.inquiryId) {
        setCreated({ inquiryId: result.inquiryId, accessPassword: values.accessPassword });
        return;
      }
      for (const [field, reason] of Object.entries(result.fieldErrors ?? {})) {
        setError(field as keyof GuestInquiryValues, { message: reason });
      }
      if (result.formError) setFormError(result.formError);
    });
  });

  // I01-1 [확인] → I04 화면에서 방금 남긴 문의(I03)를 연다
  const goToInquiry = () => {
    if (!created) return;
    openStored(created.inquiryId, created.accessPassword);
    // 기록을 바꿔치기해, 뒤로 가기로 보낸 내용이 든 문의하기에 돌아가지 않게 한다(회원 문의와 같음)
    router.replace(ROUTES.guestInquiry);
  };

  const message = (text?: string) => (text ? { text, tone: "error" as const } : undefined);

  return (
    <>
      <form onSubmit={submit} noValidate className="flex w-full flex-col gap-7">
        <div className="flex w-full flex-col gap-7 sm:flex-row sm:gap-4">
          <div className="min-w-0 flex-1">
            <Field
              label="이메일"
              htmlFor="email"
              variant="md"
              message={message(errors.email?.message)}
            >
              <TextInput
                id="email"
                variant="md"
                type="email"
                autoComplete="email"
                placeholder="example@ssafy.com"
                invalid={!!errors.email}
                {...register("email")}
              />
            </Field>
          </div>
          <div className="min-w-0 flex-1">
            <Field
              label="조회 비밀번호"
              htmlFor="accessPassword"
              variant="md"
              message={message(errors.accessPassword?.message)}
              hint={
                <span className="text-[13px] leading-normal font-medium text-text-3">
                  문의번호와 함께 답변을 확인할 때 써요
                </span>
              }
            >
              <TextInput
                id="accessPassword"
                variant="md"
                type="password"
                autoComplete="new-password"
                placeholder="4~20자"
                maxLength={20}
                invalid={!!errors.accessPassword}
                {...register("accessPassword")}
              />
            </Field>
          </div>
        </div>
        <Field
          label="제목"
          htmlFor="title"
          variant="md"
          message={message(errors.title?.message)}
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
            invalid={!!errors.title}
            {...register("title")}
          />
        </Field>
        <Field
          label="내용"
          htmlFor="content"
          variant="md"
          message={message(errors.content?.message)}
        >
          <TextArea
            id="content"
            heightClass="h-40"
            placeholder="궁금한 점이나 요청을 적어 주세요"
            invalid={!!errors.content}
            {...register("content")}
          />
        </Field>
        <PhotoField picks={picks} disabled={pending} />
        <div className="flex flex-col gap-2 rounded-xl bg-bg-sub p-4">
          <div className="flex items-center gap-2.5">
            <Checkbox
              checked={agreed}
              className="flex-1"
              aria-invalid={!!errors.agreed}
              {...register("agreed")}
            >
              <span className="text-sm leading-normal font-medium text-text-1">
                [필수] 개인정보 수집 · 이용 동의
              </span>
            </Checkbox>
            <LegalViewButton
              title={GUEST_INQUIRY_CONSENT.title}
              onClick={() => setViewingConsent(true)}
            />
          </div>
          {errors.agreed?.message && (
            <p role="alert" className="text-[13px] leading-normal font-semibold text-danger">
              {errors.agreed.message}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <Link
              href={ROUTES.guestInquiry}
              className={`w-[120px] ${inquiryButtonClass("secondary")}`}
            >
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

      <InquiryModal open={created !== null} labelledBy="inquiry-created-title" width="w-[480px]">
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 id="inquiry-created-title" className="text-2xl leading-normal font-bold text-text-1">
            문의를 남겼어요
          </h2>
          <p className="text-sm leading-normal font-semibold text-text-3">문의번호</p>
          <p className="text-[56px] leading-[1.2] font-extrabold text-brand-strong">
            {created?.inquiryId}
          </p>
          <p className="text-[15px] leading-normal font-medium text-text-2">
            문의번호와 조회 비밀번호로 답변을 확인할 수 있어요.
            <br />꼭 기억해 주세요.
          </p>
        </div>
        <InquiryButton kind="primary" className="mt-6 w-full" autoFocus onClick={goToInquiry}>
          확인
        </InquiryButton>
      </InquiryModal>

      <LegalModal
        doc={viewingConsent ? GUEST_INQUIRY_CONSENT : null}
        onClose={() => setViewingConsent(false)}
      />
    </>
  );
}
