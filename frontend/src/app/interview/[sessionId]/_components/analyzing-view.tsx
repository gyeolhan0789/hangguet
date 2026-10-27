"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { ThinkingAvatar } from "@/components/interview/thinking-avatar";
import type { AnalysisStep, SessionResponse } from "@/types/api";

// 기준: Figma S06-1 결과 분석 중(18:4437: Vignette(가운데 투명 → 가장자리 rgba(11,13,20,.95)) · 가운데 세로 간격 24
// · Thinking Avatar 132(Ring Track · Spinner Arc · Avatar 108 둥근) · '면접관이 답변을 검토하고 있어요' 34 ExtraBold 흰색 자간 -0.8
// · '보통 10초 안에 끝나요' 16 Medium 흰색 60% · Steps 420(흰색 8% · 테두리 흰색 12% · 둥글기 20 · 패딩 24 · 간격 14
// · 완료 circle-check 20 + 16 Medium 흰색 / 진행 loader-circle 20 + 16 Bold 흰색 / 대기 circle 20 + 16 Medium 흰색 40%
// · 진행 바 372×6 흰색 12% · 채움 brand(2단계 진행 중 210/372)) · Tip(흰색 6% · lightbulb 16 · 14 SemiBold 흰색 80%))
// · Swagger 5.2 status · analysisStep(ORGANIZING_ANSWERS → SCORING → WRITING_FEEDBACK)
// · 모션 메모 S06-1(18:4469: 아바타 둘레 주황 호 rotate 0→360 · 1.2s linear 루프, 단계 체크가 하나씩 ✓로 바뀌며 다음 줄 스피너 시작
// (실제 API 진행에 맞춰), 진행 바 width 증가, 30초 초과: '조금만 더 기다려 주세요')
// · 기획 메모 S06-1(18:3531: 평가 API 응답 대기, 예상 5~15초)

/**
 * 분석 단계 순서와 문구(Figma Step 1 · 2 · 3). Figma에는 단계마다 문구가 하나씩만 있어(1 완료형 · 2 진행형 · 3 대기형)
 * 상태와 관계없이 그 문구를 쓰고, 완료 · 진행 · 대기는 아이콘과 글자 굵기 · 색으로만 나눈다.
 */
const STEPS: { step: AnalysisStep; label: string }[] = [
  { step: "ORGANIZING_ANSWERS", label: "답변을 정리했어요" },
  { step: "SCORING", label: "평가 기준별로 분석하는 중…" },
  { step: "WRITING_FEEDBACK", label: "피드백을 쓰는 중" },
];

/** 진행 바 채움 비율. Figma(2단계 진행 중 210/372)를 단계 수에 비례해 늘인다. 모두 끝나면 1 */
export function analysisProgress(index: number): number {
  if (index >= STEPS.length) return 1;
  return ((index + 1) * (210 / 372)) / 2;
}

/** 이 시간이 지나도 끝나지 않으면 안내 문구를 바꾼다(모션 메모 30초) */
export const LONG_WAIT_MS = 30_000;

/** S06-1 결과 분석 중. 2초마다 화면을 다시 그려(InterviewRoom) analysisStep을 따라간다. */
export function AnalyzingView({ session }: { session: SessionResponse }) {
  const reduce = useReducedMotion();
  const [longWait, setLongWait] = useState(false);
  // 지금 진행 중인 단계. 결과가 나왔으면(COMPLETED) 모두 끝난 것으로 본다.
  const index =
    session.status === "COMPLETED"
      ? STEPS.length
      : Math.max(
          0,
          STEPS.findIndex(({ step }) => step === session.analysisStep),
        );

  useEffect(() => {
    const timer = setTimeout(() => setLongWait(true), LONG_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 overflow-y-auto bg-[radial-gradient(ellipse_closest-side_at_center,rgba(11,13,20,0)_0%,rgba(11,13,20,0.95)_100%)] px-4 py-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: reduce ? 0 : 0.3 }}
    >
      <ThinkingAvatar persona={session.persona} />

      <h1 className="text-center text-[28px] leading-[1.3] font-extrabold tracking-[-0.8px] break-keep text-white md:text-[34px]">
        면접관이 답변을 검토하고 있어요
      </h1>
      <p className="text-base leading-normal font-medium text-white/60">
        {longWait ? "조금만 더 기다려 주세요" : "보통 10초 안에 끝나요"}
      </p>

      <div className="flex w-full max-w-[420px] flex-col gap-3.5 rounded-[20px] border border-white/12 bg-white/8 p-6">
        <ol className="flex flex-col gap-3.5">
          {STEPS.map((item, i) => (
            <Step
              key={item.step}
              item={item}
              state={i < index ? "done" : i === index ? "doing" : "waiting"}
            />
          ))}
        </ol>
        <span
          role="progressbar"
          aria-label="결과 분석 진행"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(analysisProgress(index) * 100)}
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/12"
        >
          <motion.span
            className="absolute inset-y-0 left-0 rounded-full bg-brand"
            initial={false}
            animate={{ width: `${analysisProgress(index) * 100}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </span>
      </div>

      <p className="flex items-center gap-2 rounded-full bg-white/6 px-[18px] py-3 text-sm leading-normal font-semibold break-keep text-white/80">
        <Image
          src="/interview/icon-lightbulb.svg"
          alt=""
          width={16}
          height={16}
          className="shrink-0"
        />
        기다리는 동안 한 줄 팁 · 꼬리 질문엔 근거부터 짧게!
      </p>
    </motion.div>
  );
}

function Step({
  item,
  state,
}: {
  item: (typeof STEPS)[number];
  state: "done" | "doing" | "waiting";
}) {
  const reduce = useReducedMotion();
  return (
    <li className="flex items-center gap-3" aria-current={state === "doing" ? "step" : undefined}>
      {state === "done" && (
        <Image src="/interview/icon-circle-check.svg" alt="" width={20} height={20} />
      )}
      {state === "doing" && (
        <motion.span
          className="flex"
          animate={reduce ? undefined : { rotate: 360 }}
          transition={{ duration: 1, ease: "linear", repeat: Infinity }}
        >
          <Image src="/interview/icon-loader-circle.svg" alt="" width={20} height={20} />
        </motion.span>
      )}
      {state === "waiting" && (
        <Image src="/interview/icon-circle.svg" alt="" width={20} height={20} />
      )}
      <span
        className={`text-base leading-normal ${
          state === "doing"
            ? "font-bold text-white"
            : state === "done"
              ? "font-medium text-white"
              : "font-medium text-white/40"
        }`}
      >
        {item.label}
      </span>
    </li>
  );
}
