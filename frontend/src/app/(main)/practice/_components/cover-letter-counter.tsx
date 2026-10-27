"use client";

import {
  animate,
  motion,
  useAnimate,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useEffect, useRef } from "react";

// 기준: Figma S03 Label Row 자기소개서(18:2096: 13px SemiBold text-3, "1,248 / 3,000")
// · 모션 메모 S03 "숫자가 바뀔 때 살짝 튀는 카운트업, 2,800자 넘으면 주황 → 3,000자 도달 시 빨강 + 흔들림(x [-4,4,-2,2,0])"

/** 이 글자 수를 넘으면 주황으로 바꿔 끝이 가까움을 알린다 */
export const COVER_LETTER_WARN = 2800;

/** 글자 수 상태: 기본 · 끝이 가까움(2,800자 초과) · 최대 */
export type CounterTone = "normal" | "near" | "max";

export function counterTone(length: number, max: number): CounterTone {
  if (length >= max) return "max";
  if (length > COVER_LETTER_WARN) return "near";
  return "normal";
}

const TONE_CLASS: Record<CounterTone, string> = {
  normal: "text-text-3",
  near: "text-brand-ink",
  max: "text-danger",
};

/** 색만으로 상태를 알리지 않도록(WCAG 1.4.1) 화면 낭독기에는 상태를 글로도 읽어 준다. 화면에는 보이지 않는다. */
const TONE_LABEL: Record<CounterTone, string> = {
  normal: "",
  near: ", 최대 글자 수에 가까워요",
  max: ", 최대 글자 수예요",
};

const format = (value: number) => Math.round(value).toLocaleString("ko-KR");

export function CoverLetterCounter({
  id,
  length,
  max,
}: {
  id: string;
  length: number;
  max: number;
}) {
  const [scope, animateScope] = useAnimate<HTMLParagraphElement>();
  const reduce = useReducedMotion();
  const count = useMotionValue(length);
  const text = useTransform(count, format);
  const previous = useRef(length);

  useEffect(() => {
    if (previous.current === length) return;
    const reachedMax = previous.current < max && length >= max;
    previous.current = length;
    if (reduce) {
      count.set(length);
      return;
    }
    // 숫자는 이전 값에서 새 값까지 세어 올라가고(붙여넣기처럼 크게 바뀔 때 보인다), 바뀔 때마다 살짝 튄다.
    const counting = animate(count, length, { duration: 0.25, ease: "easeOut" });
    if (scope.current) {
      animateScope(scope.current, reachedMax ? { x: [-4, 4, -2, 2, 0] } : { y: [0, -2, 0] }, {
        duration: reachedMax ? 0.35 : 0.2,
      });
    }
    return () => counting.stop();
  }, [length, max, reduce, count, scope, animateScope]);

  const tone = counterTone(length, max);

  // 세어 올라가는 숫자는 눈으로만 보고, 화면 낭독기는 실제 글자 수와 상태를 바로 읽는다.
  return (
    <p
      ref={scope}
      id={id}
      className={`text-[13px] leading-normal font-semibold tracking-[-0.2px] tabular-nums transition-colors ${TONE_CLASS[tone]}`}
    >
      <span className="sr-only">
        글자 수 {format(length)} / {format(max)}
        {TONE_LABEL[tone]}
      </span>
      <span aria-hidden>
        <motion.span>{text}</motion.span> / {format(max)}
      </span>
    </p>
  );
}
