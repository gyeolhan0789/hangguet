"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";

import { endSession, submitTextAnswer } from "@/lib/interview/actions";
import { ANSWER_TEXT_MAX, answerTextSchema, type AnswerTextValues } from "@/lib/interview/schemas";
import { useInterviewStore } from "@/stores/interview-store";
import type { CurrentQuestion } from "@/types/api";

// 기준: Figma S06-B Chat Input(18:2606: 반투명 rgba(14,16,22,.8) · blur 8 · 테두리 흰색 20% · 둥글기 20 · 패딩 18 · 간격 12
// · '답변을 입력하세요…' 17 Medium 흰색 50% · 빈 줄 44 · 'Enter 전송 · Shift + Enter 줄바꿈 · 0 / 1,000' 13 Medium 흰색 40%
// · Send 44(brand-strong · send 20)) · S06 STT Bubble(18:2539: 흰색 8% · 테두리 흰색 15% · 둥글기 20 · 18 Medium) — 보낸 답변 말풍선
// · 웹 Swagger 5.7 답변 제출(TEXT · content 1~1,000자) · 5.8 면접 끝내기(isLastQuestion이면 자동)
// · 기획 메모 S06-B(18:1050: Enter 전송 / Shift+Enter 줄바꿈)
// · 모션 메모 S06-B(18:2615: 포커스 시 테두리 주황 + 높이 자동 확장(최대 5줄), 전송: 보낸 답변이 말풍선으로 위로 날아가며 사라짐
// → 면접관 '생각 중' 점 3개 → 다음 질문 타자 등장)

/** 입력창이 늘어나는 최대 줄 수(모션 메모 최대 5줄) */
const MAX_LINES = 5;
/** 한 줄 높이(17px × 1.5) */
const LINE_PX = 25.5;
/** 입력창 기본 높이: 첫 줄 + 간격 12 + Figma 빈 줄 44 */
const MIN_PX = LINE_PX + 12 + 44;

/** S06-B 채팅 답변 입력창. 질문을 기다리는 동안은 입력할 수 없다. */
export function ChatPanel({
  sessionId,
  question,
}: {
  sessionId: number;
  /** 답할 질문. 다음 질문을 기다리는 중이면 null */
  question: CurrentQuestion | null;
}) {
  const reduce = useReducedMotion();
  const setAnsweredQuestion = useInterviewStore((state) => state.setAnsweredQuestion);
  const setLeveledUp = useInterviewStore((state) => state.setLeveledUp);
  const [pending, startSubmit] = useTransition();
  const [sent, setSent] = useState<{ id: number; text: string } | null>(null);
  const [formError, setFormError] = useState<string>();
  // 같은 질문 · 같은 답변을 다시 보낼 때는 같은 키를 쓴다(5.7 멱등 키). 끝내기(5.8)도 한 키로 다시 보낸다.
  const answerKey = useRef<{ questionId: number; content: string; key: string } | null>(null);
  const endKey = useRef<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<AnswerTextValues>({
    resolver: zodResolver(answerTextSchema),
    defaultValues: { content: "" },
  });
  const length = useWatch({ control, name: "content" }).length;
  const disabled = !question || pending;
  const { ref, ...field } = register("content");
  const textarea = useRef<HTMLTextAreaElement | null>(null);

  // 글 높이에 맞춰 입력창을 늘린다(최대 5줄, 넘으면 스크롤).
  function fit() {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, MIN_PX), LINE_PX * MAX_LINES)}px`;
  }

  function submit(values: AnswerTextValues) {
    if (!question) return;
    setFormError(undefined);
    const saved = answerKey.current;
    const key =
      saved && saved.questionId === question.id && saved.content === values.content
        ? saved.key
        : crypto.randomUUID();
    answerKey.current = { questionId: question.id, content: values.content, key };

    startSubmit(async () => {
      const result = await submitTextAnswer(sessionId, question.id, values, key);
      if (result.keySpent) answerKey.current = null;
      if (result.fieldErrors?.content) {
        setError("content", { message: result.fieldErrors.content });
        return;
      }
      if (result.formError) {
        setFormError(result.formError);
        return;
      }
      setSent({ id: question.id, text: values.content });
      reset({ content: "" });
      requestAnimationFrame(fit);
      setAnsweredQuestion(question.id);
      if (result.isLastQuestion) {
        endKey.current ??= crypto.randomUUID();
        const ended = await endSession(sessionId, endKey.current);
        if (ended.keySpent) endKey.current = null;
        if (ended.formError) setFormError(ended.formError);
        else setLeveledUp(ended.leveledUp ?? null);
      }
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // 한글을 조합하는 중의 Enter는 글자를 확정하는 키라 보내지 않는다.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!disabled) void handleSubmit(submit)();
  }

  const error = errors.content?.message ?? formError;

  return (
    <div className="relative w-full">
      <AnimatePresence>
        {sent && (
          <motion.p
            key={sent.id}
            aria-hidden
            className="absolute inset-x-0 bottom-full mb-3 line-clamp-2 rounded-[20px] border border-white/15 bg-white/8 px-[22px] py-4 text-lg leading-normal font-medium break-keep text-white backdrop-blur-[8px]"
            initial={{ opacity: 1, y: 0 }}
            animate={reduce ? { opacity: 0 } : { opacity: 0, y: -80 }}
            transition={{ duration: 0.6, ease: "easeIn" }}
            onAnimationComplete={() => setSent(null)}
          >
            {sent.text}
          </motion.p>
        )}
      </AnimatePresence>

      <form
        onSubmit={(event) => void handleSubmit(submit)(event)}
        className="flex w-full flex-col gap-3 rounded-[20px] border border-white/20 bg-[rgba(14,16,22,0.8)] p-[18px] backdrop-blur-[8px] transition-colors duration-200 focus-within:border-brand"
      >
        <textarea
          {...field}
          ref={(element) => {
            ref(element);
            textarea.current = element;
          }}
          aria-label="답변"
          aria-invalid={Boolean(errors.content) || undefined}
          placeholder="답변을 입력하세요…"
          maxLength={ANSWER_TEXT_MAX}
          disabled={disabled}
          onKeyDown={onKeyDown}
          onInput={fit}
          style={{ height: MIN_PX }}
          className="w-full resize-none bg-transparent text-[17px] leading-normal font-medium text-white outline-none placeholder:text-white/50 disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-between gap-3">
          {error ? (
            <p role="alert" className="text-[13px] leading-normal font-medium text-[#ff8a8a]">
              {error}
            </p>
          ) : (
            <p className="text-[13px] leading-normal font-medium text-white/40">
              Enter 전송 · Shift + Enter 줄바꿈 · {length.toLocaleString()} /{" "}
              {ANSWER_TEXT_MAX.toLocaleString()}
            </p>
          )}
          <button
            type="submit"
            aria-label="답변 보내기"
            disabled={disabled}
            aria-busy={pending || undefined}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed"
          >
            <Image src="/interview/icon-send.svg" alt="" width={20} height={20} />
          </button>
        </div>
      </form>
    </div>
  );
}
