"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import Image from "next/image";
import { Fragment } from "react";

import { PERSONAS } from "@/lib/interview/personas";
import { durationMinutes } from "@/lib/result/format";
import type { ResultResponse } from "@/types/api";

// 기준: Figma S07 Summary(18:2640: 메타 15 SemiBold text-3 · 간격 10 · 총평 36 ExtraBold text-1 행간 1.3
// · 오른쪽 면접관 썸네일 80 원형) · ResultResponse(persona · companyName · jobTitle · summary · startedAt · endedAt)
// · 모션 메모 S07(18:2705: 총평 문장이 단어 단위로 떠오름 stagger 0.04s) · 사용자 결정(2026-10-22: 썸네일은 이미지)
// · ResultResponse.summary(null일 수 있음 — 없으면 총평 줄을 그리지 않는다)

const sentence: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.04 } } };
const word: Variants = { hidden: { opacity: 0, y: "0.4em" }, shown: { opacity: 1, y: 0 } };

/** 결과 맨 위: 면접관 · 회사 직무 · 면접 시간, 한 줄 총평, 면접관 썸네일 */
/** 요약 문장의 단어. 단어는 겹칠 수 있어 문장 안 위치(position)를 key로 쓴다(받은 문장은 바뀌지 않는다) */
function summaryWords(summary: string) {
  return summary.split(" ").map((text, position) => ({ text, position }));
}

export function ResultSummary({ result }: Readonly<{ result: ResultResponse }>) {
  const reduce = useReducedMotion();
  const persona = PERSONAS.find((info) => info.persona === result.persona);
  const minutes = durationMinutes(result.startedAt, result.endedAt);

  return (
    <section className="flex w-full items-center justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-2.5">
        <p className="text-[15px] leading-normal font-semibold tracking-[-0.2px] break-keep text-text-3">
          {persona?.name} · {result.companyName} {result.jobTitle} · {minutes}분
        </p>
        {result.summary && (
          <motion.h1
            aria-label={result.summary}
            className="text-[28px] leading-[1.3] font-extrabold tracking-[-1px] break-keep text-text-1 md:text-[36px]"
            variants={sentence}
            initial={reduce ? false : "hidden"}
            animate="shown"
          >
            {summaryWords(result.summary).map(({ text, position }) => (
              <Fragment key={position}>
                {position > 0 && " "}
                <motion.span aria-hidden className="inline-block" variants={word}>
                  {text}
                </motion.span>
              </Fragment>
            ))}
          </motion.h1>
        )}
      </div>
      {persona && (
        <span className="relative size-20 shrink-0 overflow-hidden rounded-full">
          <Image
            src={persona.avatar}
            alt={persona.name}
            fill
            sizes="80px"
            className="object-cover"
          />
        </span>
      )}
    </section>
  );
}
