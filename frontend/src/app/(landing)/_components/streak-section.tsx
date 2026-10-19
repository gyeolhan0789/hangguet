"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";

import { FeatureSection } from "./feature-section";
import { CountUp } from "./motion-utils";

const DONE_DAYS = ["월", "화", "수", "목", "금", "토"] as const;

// ✦ 반짝이 3개 (Figma 520×540 카드 기준 위치)
const TWINKLES = [
  { src: "/landing/twinkle-1.svg", size: 22, left: 400, top: 70 },
  { src: "/landing/twinkle-2.svg", size: 14, left: 440, top: 110 },
  { src: "/landing/twinkle-3.svg", size: 16, left: 72, top: 150 },
] as const;

function PulseRing({ src, size, delay }: { src: string; size: number; delay: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      className="absolute top-1/2 left-1/2"
      style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
      animate={reduce ? undefined : { scale: [1, 1.35], opacity: [1, 0] }}
      transition={{ duration: 2, delay, repeat: Infinity, ease: "easeOut" }}
    >
      <Image src={src} alt="" width={size} height={size} />
    </motion.span>
  );
}

function Week() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();

  return (
    <div ref={ref} className="flex gap-2 sm:gap-3.5">
      {DONE_DAYS.map((day, i) => (
        <div key={day} className="flex flex-col items-center gap-2">
          <motion.span
            className="flex size-9 items-center justify-center rounded-full bg-brand-strong sm:size-11"
            initial={{ scale: 0.6 }}
            animate={inView ? { scale: 1 } : undefined}
            transition={{ delay: i * 0.08, type: "spring", stiffness: 300, damping: 18 }}
          >
            {/* 체크 표시를 그리듯 나타내기 위해 Figma icon-check 경로를 그대로 쓴다 */}
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <motion.path
                d="M16.6667 5L7.5 14.1667L3.33333 10"
                stroke="white"
                strokeWidth={1.66667}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: reduce ? 1 : 0 }}
                animate={inView ? { pathLength: 1 } : undefined}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.3, ease: "easeOut" }}
              />
            </svg>
          </motion.span>
          <span className="text-[13px] leading-normal font-medium text-text-3">{day}</span>
        </div>
      ))}
      <div className="flex flex-col items-center gap-2">
        <span className="relative size-9 sm:size-11">
          <span className="absolute inset-0 rounded-full border-[2.5px] border-brand bg-bg-sub" />
          <motion.span
            aria-hidden
            className="absolute -inset-[7px]"
            animate={reduce ? undefined : { scale: [1, 1.15, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <Image src="/landing/today-pulse.svg" alt="" fill />
          </motion.span>
        </span>
        <span className="text-[13px] leading-normal font-bold text-brand-ink">오늘</span>
      </div>
    </div>
  );
}

function StreakCard() {
  const reduce = useReducedMotion();

  return (
    <div className="relative flex w-full max-w-[520px] flex-col items-center justify-center gap-5 overflow-hidden rounded-[32px] bg-bg-sub p-6 py-12 sm:p-10 lg:h-[540px]">
      {TWINKLES.map(({ src, size, left, top }, i) => (
        <motion.span
          key={src}
          aria-hidden
          className="absolute"
          style={{ left: `${(left / 520) * 100}%`, top: `${(top / 540) * 100}%` }}
          initial={{ opacity: reduce ? 1 : 0 }}
          animate={reduce ? undefined : { opacity: [0, 1, 0], rotate: [0, 90] }}
          transition={{
            duration: 2 + i * 0.4,
            delay: i * 0.7,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <Image src={src} alt="" width={size} height={size} />
        </motion.span>
      ))}

      <span className="relative flex size-20 items-center justify-center rounded-full bg-brand-soft dark:bg-brand-soft/8">
        <PulseRing src="/landing/flame-pulse-ring.svg" size={120} delay={0} />
        <PulseRing src="/landing/flame-pulse-ring-2.svg" size={136} delay={1} />
        <Image src="/landing/icon-flame-streak.svg" alt="" width={40} height={40} />
      </span>

      <div className="flex flex-col items-center gap-0.5">
        <span className="text-base leading-normal font-semibold text-text-3">연속 연습</span>
        <span className="text-[56px] leading-[1.25] font-extrabold tracking-[-2px] text-text-1 sm:text-[72px]">
          <CountUp to={7} />
          일째
        </span>
      </div>

      <Week />

      <Link
        href="/login"
        className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-[14px] bg-brand-strong px-6 text-[17px] font-bold text-white"
      >
        오늘의 연습 시작하기
        {/* 빛 줄기: 2.4초마다 왼쪽에서 오른쪽으로 한 번 */}
        <motion.span
          aria-hidden
          className="absolute inset-0"
          initial={{ x: "-100%" }}
          animate={reduce ? undefined : { x: ["-100%", "100%"] }}
          transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 1.5, ease: "easeInOut" }}
        >
          <span className="absolute inset-y-0 left-0 w-[70px] bg-linear-to-r from-white/0 via-white/35 to-white/0" />
        </motion.span>
      </Link>
    </div>
  );
}

export function StreakSection() {
  return (
    <FeatureSection
      id="features"
      eyebrow="매일 들어오게 되는 이유"
      title={["끊기기 싫은", "스트릭"]}
      body={"하루라도 쉬면 0일.\n그래서 오늘도 한 번 더 들어오게 돼요."}
      visual={<StreakCard />}
    />
  );
}
