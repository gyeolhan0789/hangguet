"use client";

import { useRef } from "react";

import { todayKst } from "@/lib/date";
import type { ResultResponse } from "@/types/api";

import { CriteriaScores } from "./criteria-scores";
import { QuestionFeedback } from "./question-feedback";
import { ResultActionBar } from "./result-action-bar";
import { ResultSummary } from "./result-summary";

// 기준: Figma S07 피드백 결과(18:2620: Body 위 36 · 가운데 880 · 간격 32 — Summary → Criteria → 질문별 피드백, 아래 Sticky Bar)
// · 기획 메모 S07(18:762: 이번 면접 1회의 결과만) · Swagger 6.3 ResultResponse

/** S07 피드백 결과 화면 */
export function ResultView({ result }: { result: ResultResponse }) {
  // 페이지 끝. 여기가 보이면 아래 막대의 버튼이 한 번 통통 튄다(모션 메모 S07).
  const end = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className="mx-auto flex w-full max-w-[912px] flex-1 flex-col gap-8 px-4 pt-9 pb-10">
        <ResultSummary result={result} />
        <CriteriaScores scores={result.sessionScores} />
        <QuestionFeedback sessionId={result.id} answers={result.answers} />
        <div ref={end} aria-hidden className="h-px" />
      </div>
      <ResultActionBar
        sessionId={result.id}
        reviewDate={todayKst(new Date(result.startedAt))}
        end={end}
      />
    </>
  );
}
