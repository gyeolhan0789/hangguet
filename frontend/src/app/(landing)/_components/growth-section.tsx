"use client";

import { motion } from "motion/react";
import Image from "next/image";

import { FeatureSection } from "./feature-section";
import { CountUp } from "./motion-utils";

// Figma 막대 길이(440 중 361·282·317)를 비율로 옮긴 값
const GROWTH = [
  { label: "전달력", delta: 8, fill: 0.82 },
  { label: "논리성", delta: 4, fill: 0.64 },
  { label: "자소서 검증", delta: null, fill: 0.72 },
] as const;

const CONFETTI = [
  { src: "/landing/confetti-1.svg", size: 20, className: "-top-[34px] right-[60px]", rotate: 15 },
  { src: "/landing/confetti-2.svg", size: 13, className: "-top-[14px] right-[30px]", rotate: -15 },
  { src: "/landing/confetti-3.svg", size: 18, className: "-top-[28px] right-[114px]", rotate: -15 },
] as const;

const inView = { once: true, amount: 0.5 } as const;

function GrowthCard() {
  return (
    <div className="relative flex w-full max-w-[520px] flex-col justify-center gap-6 rounded-[32px] bg-bg-sub p-6 py-10 sm:p-10 lg:h-[540px]">
      <p className="text-[22px] leading-normal font-bold text-text-1">오늘 나아진 점</p>

      {GROWTH.map(({ label, delta, fill }, i) => (
        <div key={label} className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-base leading-normal font-semibold text-text-2">{label}</span>
            <span className="rounded-full bg-brand-soft dark:bg-brand-soft/8 px-2.5 py-1 text-sm leading-normal font-bold text-brand-ink">
              {delta === null ? "통과" : <CountUp to={delta} prefix="+" duration={0.8} />}
            </span>
          </div>
          <div className="relative h-2.5 rounded-full bg-surface">
            <motion.span
              className="absolute inset-y-0 left-0 origin-left rounded-full bg-brand"
              style={{ width: `${fill * 100}%` }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={inView}
              transition={{ duration: 0.8, ease: "easeOut", delay: i * 0.15 }}
            />
            {i === 0 && (
              <motion.span
                className="absolute -top-8 rounded-full bg-brand-strong px-2 py-1 text-xs leading-[1.4] font-extrabold text-white"
                style={{ left: `calc(${fill * 100}% + 4px)` }}
                initial={{ scale: 0 }}
                whileInView={{ scale: 1 }}
                viewport={inView}
                transition={{ type: "spring", stiffness: 500, damping: 15, delay: 0.9 }}
              >
                ↑
              </motion.span>
            )}
          </div>
        </div>
      ))}

      <motion.div
        className="relative flex items-center gap-2.5 rounded-2xl bg-brand-soft dark:bg-brand-soft/8 px-5 py-4"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={inView}
        transition={{ duration: 0.5, ease: "easeOut", delay: 1 }}
      >
        <Image src="/landing/icon-flame-toast.svg" alt="" width={22} height={22} />
        <span className="text-[17px] leading-normal font-bold text-brand-ink">
          8일째 연습 완료!
        </span>
        {CONFETTI.map(({ src, size, className, rotate }) => (
          <motion.span
            key={src}
            aria-hidden
            className={`absolute ${className}`}
            initial={{ scale: 0, rotate: 0 }}
            whileInView={{ scale: [0, 1.2, 1], rotate: [0, rotate, 0] }}
            viewport={inView}
            transition={{ duration: 0.6, delay: 1.3 }}
          >
            <Image src={src} alt="" width={size} height={size} />
          </motion.span>
        ))}
      </motion.div>
    </div>
  );
}

export function GrowthSection() {
  return (
    <FeatureSection
      eyebrow="끝나면 바로 보여요"
      title={["오늘 뭐가", "나아졌는지 한눈에"]}
      body={"점수보다 중요한 건 어제보다 나아진 점.\n매일 쌓이는 게 눈에 보여요."}
      visual={<GrowthCard />}
    />
  );
}
