"use client";

import { motion } from "motion/react";

// 진행 막대(S05 질문 준비 · S06 질문 진행 · S06-B 대기 화면 · S06-1 결과 분석이 같이 쓴다).
// 보조기기는 화면에 보이지 않는 네이티브 <progress>로 값을 읽고, 보이는 막대는 Motion으로 부드럽게 채운다.
// ARIA progressbar 역할 대신 네이티브 요소를 쓴다(HTML이 같은 뜻의 요소를 주면 역할보다 요소를 쓴다 — 소나 S6819).

export function ProgressBar({
  label,
  value,
  max = 100,
  fill = value / max,
  duration,
  className,
  fillClassName,
}: Readonly<{
  /** 보조기기가 읽는 이름 */
  label: string;
  /** 보조기기가 읽는 값(0~max) */
  value: number;
  max?: number;
  /** 보이는 막대가 찬 비율(0~1). 기본은 value / max */
  fill?: number;
  /** 채우는 애니메이션 시간(초) */
  duration: number;
  /** 막대 바탕(크기 · 색) */
  className: string;
  /** 찬 부분 색 */
  fillClassName: string;
}>) {
  return (
    <>
      <progress aria-label={label} max={max} value={value} className="sr-only" />
      <span aria-hidden className={`relative block overflow-hidden rounded-full ${className}`}>
        <motion.span
          className={`absolute inset-y-0 left-0 rounded-full ${fillClassName}`}
          initial={false}
          animate={{ width: `${fill * 100}%` }}
          transition={{ duration, ease: "easeOut" }}
        />
      </span>
    </>
  );
}
