"use client";

import {
  animate,
  motion,
  MotionConfig,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

/** 서버·클라이언트에서 같은 값이 나와야 하는 "랜덤" 값(0~1). 하이드레이션 불일치를 막는다. */
export function seeded(index: number, salt: number) {
  const x = Math.sin(index * 9301 + salt * 49297) * 233280;
  return x - Math.floor(x);
}

/** 운영체제의 "동작 줄이기"를 켜면 이동·확대 애니메이션을 끄고 페이드만 남긴다. */
export function LandingMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** 아래 섹션 공통 등장: 화면에 40% 들어오면 y 32→0, opacity 0→1 (0.6s). */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.6, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}

/** 화면에 들어오면 0부터 to까지 숫자를 올린다. */
export function CountUp({
  to,
  prefix = "",
  duration = 1.2,
}: {
  to: number;
  prefix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const value = useMotionValue(0);
  const text = useTransform(value, (v) => `${prefix}${Math.round(v)}`);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      value.set(to);
      return;
    }
    const controls = animate(value, to, { duration, ease: "easeOut" });
    return () => controls.stop();
  }, [inView, reduce, to, duration, value]);

  return <motion.span ref={ref}>{text}</motion.span>;
}

/** [cx, cy, r, opacity] — Figma "Ember Particles" 레이어의 점 위치를 그대로 옮긴 값 */
export type Ember = readonly [number, number, number, number];

/** 불씨: 각자 위로 120px 떠오르며 깜빡이고, 좌우로 ±20px 흔들린다. 모바일은 절반만, 화면 밖이면 멈춘다. */
export function Embers({
  embers,
  width,
  height,
}: {
  embers: readonly Ember[];
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduce = useReducedMotion();
  const moving = inView && !reduce;

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0">
      {embers.map(([cx, cy, r, opacity], i) => {
        const duration = 4 + seeded(i, 1) * 5;
        return (
          <motion.span
            key={i}
            className={`absolute rounded-full bg-[#ffb27a] will-change-transform ${i % 2 ? "hidden sm:block" : ""}`}
            style={{
              left: `${(cx / width) * 100}%`,
              top: `${(cy / height) * 100}%`,
              width: r * 2,
              height: r * 2,
              marginLeft: -r,
              marginTop: -r,
              opacity,
            }}
            animate={
              moving ? { y: [0, -120], opacity: [0, opacity, 0], x: [0, 20, 0, -20, 0] } : undefined
            }
            transition={{
              duration,
              delay: seeded(i, 2) * 4,
              repeat: Infinity,
              ease: "linear",
              x: { duration, repeat: Infinity, ease: "easeInOut" },
            }}
          />
        );
      })}
    </div>
  );
}
