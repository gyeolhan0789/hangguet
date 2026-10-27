"use client";

import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import Image from "next/image";
import { useRef, useState } from "react";

import { Reveal } from "./motion-utils";

const STEPS = [
  { title: "지원서 입력", desc: "회사 · 직무 · 자소서", icon: "/landing/icon-file-text.svg" },
  { title: "면접관 선택", desc: "악마 면접관 · 개발자 커피챗", icon: "/landing/icon-users.svg" },
  { title: "3D 면접", desc: "음성으로 묻고 답하기", icon: "/landing/icon-mic.svg" },
  { title: "피드백 · 성장 리뷰", desc: "오늘 나아진 점 확인", icon: "/landing/icon-sparkles.svg" },
] as const;

export function StepsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // 진행 라인은 스크롤에 맞춰 왼쪽부터 채워지고, 라인이 닿은 카드부터 나타난다.
  // 스크롤 범위의 가운데 70%(앞뒤 15%씩 제외)에서 0→1로 채운다.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 60%"] });
  const centered = useTransform(scrollYProgress, [0.15, 0.85], [0, 1]);
  const progress = useTransform(centered, (v) => (reduce ? 1 : v));
  const dotX = useTransform(progress, [0, 1], ["0%", "100%"]);
  const [reached, setReached] = useState(0);

  useMotionValueEvent(progress, "change", (v) => {
    const next = Math.min(STEPS.length, Math.floor(v * STEPS.length + 0.75));
    setReached((prev) => Math.max(prev, next));
  });

  return (
    <section
      id="steps"
      className="flex scroll-mt-18 flex-col items-center gap-14 bg-bg px-6 py-[120px] lg:px-10"
    >
      <Reveal className="flex flex-col items-center gap-3.5 text-center">
        <p className="text-lg leading-normal font-bold text-brand-ink">이렇게 진행돼요</p>
        <h2 className="text-[32px] leading-[1.25] font-extrabold tracking-[-1px] text-text-1 lg:text-5xl lg:tracking-[-1.4px]">
          하루 10분, 네 단계면 끝
        </h2>
      </Reveal>

      <div ref={ref} className="flex w-full max-w-[1120px] flex-col gap-14">
        <div aria-hidden className="relative h-1 rounded-full bg-line">
          <motion.span
            className="absolute inset-0 origin-left rounded-full bg-linear-to-r from-[#ffa766] to-brand-strong"
            style={{ scaleX: progress }}
          />
          <motion.span className="absolute inset-0" style={{ x: dotX }}>
            <Image
              src="/landing/head-dot.svg"
              alt=""
              width={12}
              height={12}
              className="absolute -top-1 -left-1.5"
            />
          </motion.span>
        </div>

        <ol className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => {
            const on = reached > i;
            return (
              <motion.li
                key={step.title}
                className="flex flex-col gap-3.5 rounded-3xl bg-bg-sub p-7"
                initial={{ opacity: 0, y: 24 }}
                animate={on ? { opacity: 1, y: 0 } : undefined}
                transition={{ duration: 0.5, ease: "easeOut" }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex size-9 items-center justify-center rounded-full text-base leading-normal font-extrabold transition-colors duration-300 ${on ? "bg-brand-strong text-white" : "bg-brand-soft dark:bg-brand-soft/8 text-brand-ink"}`}
                  >
                    {i + 1}
                  </span>
                  <Image src={step.icon} alt="" width={24} height={24} />
                </div>
                <p className="text-[22px] leading-normal font-bold text-text-1">{step.title}</p>
                <p className="text-base leading-normal font-medium text-text-2">{step.desc}</p>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
