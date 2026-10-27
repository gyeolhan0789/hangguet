"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useId, useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { GRADE_LABEL, firstOpenQuestion } from "@/lib/result/format";
import { replayPath } from "@/lib/routes";
import type { AnswerFeedback } from "@/types/api";

// 기준: Figma S07 Q Head(18:2661: '질문별 피드백' 20 ExtraBold · '전체 펼치기' 14 SemiBold text-3)
// · Q List(18:2665: bg-sub · 테두리 line · 둥글기 20 · 좌우 24 · 위아래 4, 줄 사이 1px 구분선)
// · 펼친 줄(18:2666: 위아래 20 · 간격 14, 'Q2' 15 ExtraBold brand-ink · 질문 17 Bold · chevron 20,
//   잘한 점(success) · 아쉬운 점(danger) 14 Bold 폭 64 · 내용 15 Medium text-2 · 왼쪽 38 · 간격 16)
// · 접힌 줄(18:2680: 위아래 18 · 'Q1' 15 ExtraBold text-3 · 질문 16 SemiBold · 등급 14 SemiBold text-3 · chevron 20)
// · 모션 메모 S07(18:2705: 질문 아코디언 높이 auto 애니메이션, 화살표 rotate 180°)
// · 접힌 줄 '아쉬워요'의 색은 S07에 예시가 없어 S07-1 질문 줄(18:4564: 아쉬워요 danger)에 맞춘다
// · 질문별 피드백은 첫 번째 WEAK · NORMAL 질문만 펼친다 · ResultResponse.answers(질문 순)
// · 사용자 결정(2026-10-22: 잘한 점 · 아쉬운 점은 고해상도대로 위아래, [전체 펼치기]를 누르면 모두 펼치고 '전체 접기'로 바뀐다,
//   펼친 질문 오른쪽 아래 [자세히 보기]를 누르면 S07-1 다시보기로 간다)

/** 질문별 피드백 아코디언 */
export function QuestionFeedback({
  sessionId,
  answers,
}: {
  sessionId: number;
  answers: AnswerFeedback[];
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => {
    const first = firstOpenQuestion(answers);
    return new Set(first === null ? [] : [first]);
  });
  const allOpen = answers.every((answer) => open.has(answer.questionId));

  function toggle(questionId: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(questionId)) next.add(questionId);
      return next;
    });
  }

  return (
    <section aria-labelledby="question-feedback" className="flex w-full flex-col gap-8">
      <div className="flex items-center justify-between gap-3 leading-normal tracking-[-0.2px]">
        <h2 id="question-feedback" className="text-xl leading-normal font-extrabold text-text-1">
          질문별 피드백
        </h2>
        <button
          type="button"
          className="cursor-pointer text-sm leading-normal font-semibold text-text-3"
          onClick={() =>
            setOpen(new Set(allOpen ? [] : answers.map((answer) => answer.questionId)))
          }
        >
          {allOpen ? "전체 접기" : "전체 펼치기"}
        </button>
      </div>
      <ul className="flex w-full flex-col rounded-[20px] border border-line bg-bg-sub px-6 py-1">
        {answers.map((answer, i) => (
          <QuestionRow
            key={answer.questionId}
            answer={answer}
            replayHref={replayPath(sessionId)}
            open={open.has(answer.questionId)}
            divider={i > 0}
            onToggle={() => toggle(answer.questionId)}
          />
        ))}
      </ul>
    </section>
  );
}

function QuestionRow({
  answer,
  replayHref,
  open,
  divider,
  onToggle,
}: {
  answer: AnswerFeedback;
  replayHref: string;
  open: boolean;
  divider: boolean;
  onToggle: () => void;
}) {
  const reduce = useReducedMotion();
  const panelId = useId();
  const points = [
    { label: "잘한 점", color: "text-success", text: answer.goodPoint },
    { label: "아쉬운 점", color: "text-danger", text: answer.improvePoint },
  ].filter((point) => point.text);

  return (
    <li className={divider ? "border-t border-line" : undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={`flex w-full cursor-pointer items-center gap-3 text-left leading-normal tracking-[-0.2px] ${
          open ? "pt-5" : "py-[18px]"
        }`}
      >
        <span
          className={`shrink-0 text-[15px] font-extrabold ${open ? "text-brand-ink" : "text-text-3"}`}
        >
          Q{answer.seq}
        </span>
        <span
          className={`min-w-0 flex-1 break-keep text-text-1 ${
            open ? "text-[17px] font-bold" : "text-base leading-normal font-semibold"
          }`}
        >
          {answer.question}
        </span>
        {!open && (
          <span
            className={`shrink-0 text-sm leading-normal font-semibold ${
              answer.grade === "WEAK" ? "text-danger" : "text-text-3"
            }`}
          >
            {GRADE_LABEL[answer.grade]}
          </span>
        )}
        <motion.span
          className="flex shrink-0"
          initial={false}
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: reduce ? 0 : 0.25 }}
        >
          <MaskIcon src="/result/icon-chevron-down.svg" size={20} className="bg-text-3" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.3, ease: "easeInOut" }}
          >
            <div className="flex items-end gap-4 pt-3.5 pb-5 pl-[38px]">
              <dl className="flex min-w-0 flex-1 flex-col gap-3.5 leading-normal tracking-[-0.2px]">
                {points.map((point) => (
                  <div key={point.label} className="flex items-start gap-4">
                    <dt className={`w-16 shrink-0 text-sm leading-normal font-bold ${point.color}`}>
                      {point.label}
                    </dt>
                    <dd className="min-w-0 text-[15px] font-medium break-keep text-text-2">
                      {point.text}
                    </dd>
                  </div>
                ))}
              </dl>
              <Link
                href={replayHref}
                className="flex shrink-0 items-center gap-0.5 text-sm leading-normal font-semibold tracking-[-0.2px] text-text-3"
              >
                자세히 보기
                <MaskIcon src="/home/icon-chevron-right.svg" size={16} className="bg-text-3" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
