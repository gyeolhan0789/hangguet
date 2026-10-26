"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Field, SubmitButton, TextInput } from "@/components/form";
import { InquiryThread } from "@/components/inquiry/inquiry-thread";
import { inquiryButtonClass } from "@/components/inquiry/inquiry-button-class";
import { InquiryHead, InquiryPage } from "@/components/inquiry/inquiry-ui";
import {
  addInquiryMessage,
  closeInquiry,
  openGuestInquiry,
  type InquiryWriteResult,
} from "@/lib/inquiry/actions";
import { guestLookupSchema, type GuestLookupValues } from "@/lib/inquiry/schemas";
import { ROUTES } from "@/lib/routes";
import { useGuestInquiryStore } from "@/stores/guest-inquiry-store";
import type { InquiryResponse } from "@/types/api";

// 기준: Figma I04 비회원 문의 확인(가운데 400 · 제목 '문의 확인' + 설명 2줄, 오른쪽 [+ 문의하기](작은 주 버튼 120)
// · 문의번호 · 조회 비밀번호 칸 · [확인](주 버튼, 칸 너비) · 실패 문구는 조회 비밀번호 칸 아래 danger(13 Medium))
// · 기획 메모 I04(문의번호 · 조회 비밀번호 → [확인] 9.3(X-Inquiry-Password) → I03, 없는 문의 · 틀린 조회 비밀번호(404)는 서버 문구,
// [+ 문의하기] → I01-B) · 기획 메모 I03(비회원은 9.3 ~ 9.5에 조회 비밀번호를 함께 보낸다, 없는 문의(404)면 I04로)
// · Swagger 9.3 · 9.4 · 9.5
// I01-1 [확인]으로 오면 store에 든 문의번호 · 조회 비밀번호로 바로 연다. 새로고침하면 store가 비어 I04부터 다시 한다.

export function GuestInquiryView() {
  const stored = useGuestInquiryStore();
  const [inquiry, setInquiry] = useState<InquiryResponse | null>(null);
  const [formError, setFormError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<GuestLookupValues>({
    resolver: zodResolver(guestLookupSchema),
    defaultValues: { inquiryId: "", accessPassword: "" },
  });

  const open = (values: GuestLookupValues) =>
    startTransition(async () => {
      const result = await openGuestInquiry(values);
      if (result.inquiry) {
        stored.open(result.inquiry.id, values.accessPassword);
        setInquiry(result.inquiry);
        return;
      }
      for (const [field, reason] of Object.entries(result.fieldErrors ?? {})) {
        setError(field as keyof GuestLookupValues, { message: reason });
      }
      if (result.formError) setFormError(result.formError);
    });

  // I01-1 [확인]으로 왔으면 방금 남긴 문의를 바로 연다(처음 그릴 때 한 번)
  const { inquiryId: storedId, accessPassword: storedPassword } = stored;
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || storedId === null || storedPassword === null) return;
    autoOpened.current = true;
    open({ inquiryId: String(storedId), accessPassword: storedPassword });
  });

  const leave = () => {
    stored.clear();
    setInquiry(null);
    setFormError(undefined);
    reset();
  };

  if (inquiry && storedPassword) {
    // 9.4 · 9.5는 쓴 메시지만 · 본문 없이 오므로 9.3을 다시 불러 메시지 · 상태 칩을 바꾼다
    // 409 INQUIRY_CLOSED(그 사이 종료)도 다시 불러 종료 상태로 그린다
    const reload = async (result: InquiryWriteResult) => {
      if (result.notFound) {
        leave();
        return result;
      }
      if (!result.error || result.closed) {
        const next = await openGuestInquiry({
          inquiryId: String(inquiry.id),
          accessPassword: storedPassword,
        });
        if (next.inquiry) setInquiry(next.inquiry);
      }
      return result;
    };
    return (
      <InquiryPage>
        <InquiryThread
          inquiry={inquiry}
          back={{ label: "내 문의", onClick: leave }}
          onSend={async (content) =>
            reload(await addInquiryMessage(inquiry.id, content, storedPassword))
          }
          onClose={async () => reload(await closeInquiry(inquiry.id, storedPassword))}
        />
      </InquiryPage>
    );
  }

  const submit = handleSubmit((values) => {
    setFormError(undefined);
    open(values);
  });
  const passwordMessage = errors.accessPassword?.message ?? formError;

  return (
    <InquiryPage narrow>
      <div className="flex w-full items-end justify-between gap-4">
        <InquiryHead
          title="문의 확인"
          sub={"문의할 때 받은 문의번호와 정한\n조회 비밀번호를 입력해 주세요"}
        />
        <Link
          href={ROUTES.guestInquiryNew}
          className={`w-[120px] ${inquiryButtonClass("primary", "sm")}`}
        >
          + 문의하기
        </Link>
      </div>
      <form onSubmit={submit} noValidate className="flex w-full flex-col gap-7">
        <Field
          label="문의번호"
          htmlFor="inquiryId"
          variant="md"
          message={
            errors.inquiryId?.message
              ? { text: errors.inquiryId.message, tone: "error" }
              : undefined
          }
        >
          <TextInput
            id="inquiryId"
            variant="md"
            inputMode="numeric"
            placeholder="예) 7"
            invalid={!!errors.inquiryId}
            {...register("inquiryId")}
          />
        </Field>
        <Field
          label="조회 비밀번호"
          htmlFor="accessPassword"
          variant="md"
          message={passwordMessage ? { text: passwordMessage, tone: "error" } : undefined}
          messageClass="text-[13px] font-medium"
        >
          <TextInput
            id="accessPassword"
            variant="md"
            type="password"
            autoComplete="off"
            placeholder="4~20자"
            maxLength={20}
            invalid={!!passwordMessage}
            {...register("accessPassword")}
          />
        </Field>
        <SubmitButton pending={pending} pendingText="확인" height="h-[54px]">
          확인
        </SubmitButton>
      </form>
    </InquiryPage>
  );
}
