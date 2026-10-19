"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { FeatureSection } from "./feature-section";

const REACTIONS = ["끄덕끄덕", "갸웃", "미소"] as const;

const PERSONAS = [
  {
    name: "악마 면접관",
    style: "압박 · 꼬리 질문",
    level: "난이도 높음",
    avatar: "/landing/interviewer.jpg",
    levelClass: "text-brand-ink",
  },
  {
    name: "개발자 커피챗",
    style: "편안한 대화형",
    level: "난이도 낮음",
    avatar: "/landing/avatar-coffeechat.jpg",
    levelClass: "text-text-2",
  },
] as const;

/** 화면에 보이는 동안 ms마다 다음 값으로 넘긴다. */
function useCycle(length: number, ms: number, active: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % length), ms);
    return () => clearInterval(timer);
  }, [length, ms, active]);
  return index;
}

function InterviewerCard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const reduce = useReducedMotion();
  const looping = inView && !reduce;
  const reaction = useCycle(REACTIONS.length, 3000, looping);
  const selected = useCycle(PERSONAS.length, 3000, looping);

  return (
    <div
      ref={ref}
      className="relative flex w-full max-w-[520px] flex-col gap-3 rounded-[32px] bg-bg-sub p-4 sm:p-6 lg:h-[540px]"
    >
      <div className="relative h-[220px] shrink-0 overflow-hidden rounded-[20px] sm:h-[300px]">
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.08 }}
          whileInView={{ scale: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <Image
            src="/landing/interviewer.jpg"
            alt="악마 면접관"
            fill
            sizes="(min-width: 640px) 472px, 100vw"
            className="object-cover"
          />
        </motion.div>
        {/* 미니 번개 플래시: 5초 간격 */}
        <motion.div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(50%_50%_at_75%_10%,rgba(185,212,255,0.2),rgba(185,212,255,0))]"
          initial={{ opacity: 0 }}
          animate={looping ? { opacity: [0, 0.6, 0] } : undefined}
          transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 4.4 }}
        />
        {/* 실시간 반응 칩 */}
        <motion.div
          className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-[rgba(14,16,22,0.7)] px-3 py-2 backdrop-blur-[6px]"
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.4 }}
        >
          <Image src="/landing/live-dot.svg" alt="" width={8} height={8} />
          <span className="text-[13px] leading-[1.4] font-bold whitespace-nowrap text-white">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={REACTIONS[reaction]}
                className="inline-block"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {REACTIONS[reaction]}
              </motion.span>
            </AnimatePresence>{" "}
            · 실시간 반응
          </span>
        </motion.div>
        {/* 타이핑 말풍선 */}
        <div
          aria-hidden
          className="absolute right-[42px] bottom-7 flex h-8 w-[68px] items-center justify-center gap-1.5 rounded-2xl bg-[rgba(14,16,22,0.7)] backdrop-blur-[6px]"
        >
          {[1, 0.6, 0.3].map((opacity, i) => (
            <motion.span
              key={i}
              className="size-2 rounded-full bg-white"
              style={{ opacity }}
              animate={looping ? { y: [0, -4, 0] } : undefined}
              transition={{ duration: 0.6, delay: i * 0.15, repeat: Infinity, repeatDelay: 0.3 }}
            />
          ))}
        </div>
      </div>

      {PERSONAS.map((persona, i) => {
        const isSelected = selected === i;
        return (
          <div
            key={persona.name}
            className="relative flex items-center gap-3.5 rounded-2xl px-4 py-3.5"
          >
            {isSelected && (
              <motion.span
                layoutId="persona-selection"
                aria-hidden
                className="absolute inset-0 rounded-2xl border-2 border-brand bg-brand-soft dark:bg-brand-soft/8"
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
              />
            )}
            <span className="relative size-12 shrink-0 overflow-hidden rounded-full">
              <Image src={persona.avatar} alt="" fill sizes="48px" className="object-cover" />
            </span>
            <span className="relative flex min-w-0 flex-1 flex-col gap-0.5 leading-normal whitespace-nowrap">
              <span className="text-[17px] font-bold text-text-1">{persona.name}</span>
              <span className="text-sm font-medium text-text-3">{persona.style}</span>
            </span>
            <span
              className={`relative rounded-lg px-2.5 py-1.5 text-[13px] leading-normal font-bold whitespace-nowrap transition-colors ${persona.levelClass} ${isSelected ? "bg-bg-sub" : "bg-surface"}`}
            >
              {persona.level}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function InterviewerSection() {
  return (
    <FeatureSection
      eyebrow="면접관이 나를 보고 있어요"
      title={["말하는 동안", "반응하는 면접관"]}
      body={"고개를 끄덕이고, 갸웃하고, 표정이 바뀌어요.\n진짜 면접처럼 긴장되게."}
      visual={<InterviewerCard />}
      visualFirst
    />
  );
}
