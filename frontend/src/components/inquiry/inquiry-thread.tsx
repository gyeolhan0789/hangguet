"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Field } from "@/components/form";
import { MaskIcon } from "@/components/mask-icon";
import type { InquiryWriteResult } from "@/lib/inquiry/actions";
import { inquiryMessageSchema, type InquiryMessageValues } from "@/lib/inquiry/schemas";
import { uploadInquiryPhotos } from "@/lib/inquiry/upload-photos";
import type { InquiryAttachment, InquiryQuestionRequest, InquiryResponse } from "@/types/api";

import { InquiryButton, InquiryHead, InquiryModal, StatusChip, TextArea } from "./inquiry-ui";
import { PHOTO_ACCEPT, PhotoTiles, usePhotoPicks } from "./photo-picker";

// 기준: Figma I03 문의 상세 · I03-1 문의 종료 확인(화이트 · 다크) · 기획 메모 I03 · I03-1
// · Swagger 9.3 문의 조회(InquiryResponse: 메시지 오래된 순) · 9.4 이어서 쓰기(201 · 409 INQUIRY_CLOSED) · 9.5 종료(204)
// · 제목 아래: '문의번호 N'(14 SemiBold text-3) + 상태 칩(간격 8), 오른쪽 [문의 종료](작은 보조 버튼 104)
// · 메시지(간격 16): 내 질문은 오른쪽 brand-soft 말풍선, 운영자 답변은 왼쪽 '운영자'(13 Bold text-2) + bg-sub · line 말풍선
//   (둥글기 16 · 위아래 14 · 좌우 18 · 15 Medium text-1), 그 아래 'MM.DD HH:mm'(12 Medium text-3, 간격 6)
// · 이어서 쓰기: '이어서 쓰기' 칸(높이 96) + [보내기](주 버튼 104, 아래 맞춤, 간격 8)
// · 종료한 문의면 입력칸 · [문의 종료] 대신 '종료한 문의예요'(409 INQUIRY_CLOSED도 같은 문구)
// · 회원 · 비회원이 같이 쓴다. 쓰기 · 종료는 부모가 넘긴 서버 액션으로 하고, 비회원은 부모가 9.3을 다시 불러 그린다.
// · 사진(Swagger 9.3 attachments · 9.11 → 9.4 attachmentKeys) · 사용자 결정(2026-11-03: 말풍선 아래 사진 칸,
//   이어서 쓰기는 입력칸 왼쪽 사진 버튼 + 입력칸 위 고른 사진 칸)

const CLOSED_TEXT = "종료한 문의예요.";

/** 말풍선 아래 붙인 사진. 누르면 원본을 새 탭에서 연다 */
function MessagePhotos({
  attachments,
  align,
}: {
  attachments: InquiryAttachment[];
  align: "start" | "end";
}) {
  if (attachments.length === 0) return null;
  return (
    <ul
      aria-label="붙인 사진"
      className={`flex max-w-[480px] flex-wrap gap-1.5 ${align === "end" ? "justify-end" : ""}`}
    >
      {attachments.map((photo, index) => (
        <li key={photo.id}>
          <a
            href={photo.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`붙인 사진 ${index + 1} 원본 보기(새 탭)`}
            className="block size-24 rounded-xl border border-line bg-surface bg-cover bg-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            style={{ backgroundImage: `url("${photo.url}")` }}
          />
        </li>
      ))}
    </ul>
  );
}

/** 2026-10-26T10:00:00+09:00 → 10.26 10:00(서버 일시는 +09:00이라 그대로 자른다) */
function stamp(dateTime: string) {
  return `${dateTime.slice(5, 10).replace("-", ".")} ${dateTime.slice(11, 16)}`;
}

export function InquiryThread({
  inquiry,
  back,
  onSend,
  onClose,
}: {
  inquiry: InquiryResponse;
  back: { label: string; href?: string; onClick?: () => void };
  onSend: (question: InquiryQuestionRequest) => Promise<InquiryWriteResult>;
  onClose: () => Promise<InquiryWriteResult>;
}) {
  const closed = inquiry.status === "CLOSED";
  const [confirming, setConfirming] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [closeError, setCloseError] = useState<string>();
  const [sending, startSending] = useTransition();
  const [closing, startClosing] = useTransition();
  const picks = usePhotoPicks();
  const photoInput = useRef<HTMLInputElement>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InquiryMessageValues>({
    resolver: zodResolver(inquiryMessageSchema),
    defaultValues: { content: "" },
  });

  // I03-1: [취소] · Esc → 닫기. 종료 요청 중에는 닫지 않는다
  useEffect(() => {
    if (!confirming || closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, closing]);

  const send = handleSubmit(({ content }) => {
    setSendError(undefined);
    startSending(async () => {
      const uploaded = await uploadInquiryPhotos(picks.files);
      if (!uploaded.keys) {
        setSendError(uploaded.error);
        return;
      }
      const result = await onSend({ content, attachmentKeys: uploaded.keys });
      if (result.error) {
        setSendError(result.error);
        return;
      }
      reset();
      picks.clear();
    });
  });

  const close = () => {
    setCloseError(undefined);
    startClosing(async () => {
      const result = await onClose();
      if (result.error) setCloseError(result.error);
      else setConfirming(false);
    });
  };

  // 사진 오류는 입력칸 탓이 아니라 문구만 보인다
  const contentError = errors.content?.message ?? sendError;
  const fieldMessage = contentError ?? picks.error;

  return (
    <>
      <div className="flex w-full items-end justify-between gap-4">
        <InquiryHead back={back} title={inquiry.title}>
          <div className="flex items-center gap-2">
            <span className="text-sm leading-normal font-semibold text-text-3">
              문의번호 {inquiry.id}
            </span>
            <StatusChip status={inquiry.status} />
          </div>
        </InquiryHead>
        {!closed && (
          <InquiryButton
            kind="secondary"
            size="sm"
            className="w-[104px]"
            onClick={() => setConfirming(true)}
          >
            문의 종료
          </InquiryButton>
        )}
      </div>

      <ol aria-label="주고받은 메시지" className="flex w-full flex-col gap-4">
        {inquiry.messages.map((m) =>
          m.authorType === "USER" ? (
            <li key={m.id} className="flex flex-col items-end gap-1.5">
              <p className="max-w-[480px] rounded-2xl bg-brand-soft px-[18px] py-3.5 text-[15px] leading-normal font-medium break-words whitespace-pre-wrap text-text-1 dark:bg-brand-soft/8">
                {m.content}
              </p>
              <MessagePhotos attachments={m.attachments} align="end" />
              <span className="text-xs leading-normal font-medium text-text-3">
                {stamp(m.createdAt)}
              </span>
            </li>
          ) : (
            <li key={m.id} className="flex flex-col items-start gap-1.5">
              <span className="text-[13px] leading-normal font-bold text-text-2">운영자</span>
              <p className="max-w-[480px] rounded-2xl border border-line bg-bg-sub px-[18px] py-3.5 text-[15px] leading-normal font-medium break-words whitespace-pre-wrap text-text-1">
                {m.content}
              </p>
              <MessagePhotos attachments={m.attachments} align="start" />
              <span className="text-xs leading-normal font-medium text-text-3">
                {stamp(m.createdAt)}
              </span>
            </li>
          ),
        )}
      </ol>

      {closed ? (
        <p className="w-full text-center text-[15px] leading-normal font-medium text-text-3">
          {CLOSED_TEXT}
        </p>
      ) : (
        <form onSubmit={send} noValidate className="flex w-full items-end gap-2">
          <input
            ref={photoInput}
            type="file"
            accept={PHOTO_ACCEPT}
            multiple
            className="hidden"
            aria-label="붙일 사진 파일"
            onChange={picks.onInputChange}
          />
          <InquiryButton
            kind="secondary"
            aria-label="사진 붙이기"
            className={`w-[54px] shrink-0 px-0! ${fieldMessage ? "mb-6" : ""}`}
            disabled={sending || picks.full}
            onClick={() => photoInput.current?.click()}
          >
            <MaskIcon src="/inquiry/icon-image-plus.svg" size={22} className="bg-text-2" />
          </InquiryButton>
          <div className="min-w-0 flex-1">
            <Field
              label="이어서 쓰기"
              htmlFor="inquiry-message"
              variant="md"
              message={fieldMessage ? { text: fieldMessage, tone: "error" } : undefined}
            >
              {picks.photos.length > 0 && (
                <div className="mb-2">
                  <PhotoTiles photos={picks.photos} onRemove={picks.remove} disabled={sending} />
                </div>
              )}
              <TextArea
                id="inquiry-message"
                heightClass="h-24"
                placeholder="더 궁금한 점을 적어 주세요"
                invalid={!!contentError}
                {...register("content")}
              />
            </Field>
          </div>
          <InquiryButton
            type="submit"
            kind="primary"
            className={`w-[104px] ${fieldMessage ? "mb-6" : ""}`}
            disabled={sending}
            aria-busy={sending || undefined}
          >
            보내기
          </InquiryButton>
        </form>
      )}

      <InquiryModal open={confirming} labelledBy="inquiry-close-title" width="w-[440px]">
        <h2 id="inquiry-close-title" className="text-2xl leading-normal font-bold text-text-1">
          문의를 종료할까요?
        </h2>
        <p className="text-base leading-normal font-medium text-text-2">
          종료하면 이 문의에는 더 쓸 수 없어요
        </p>
        {closeError && (
          <p role="alert" className="text-[13px] leading-normal font-semibold text-danger">
            {closeError}
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <InquiryButton
            kind="secondary"
            className="flex-1"
            autoFocus
            disabled={closing}
            onClick={() => setConfirming(false)}
          >
            취소
          </InquiryButton>
          <InquiryButton
            kind="primary"
            className="flex-1"
            disabled={closing}
            aria-busy={closing || undefined}
            onClick={close}
          >
            종료
          </InquiryButton>
        </div>
      </InquiryModal>
    </>
  );
}
