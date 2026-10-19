"use client";

import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import Image from "next/image";
import { useMemo, useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { useLockScroll } from "@/components/use-lock-scroll";
import { seeded } from "@/lib/seeded";
import {
  badgeGradient,
  nextTierOf,
  previousTierOf,
  tierOf,
  withAlpha,
  type StreakTier,
} from "@/lib/streak";

// Figma S02-L "Gold Embers" 24개 [cx, cy, r, opacity] (1440×900 기준)
const EMBERS = [
  [971.5, 645.5, 1.5, 0.92],
  [512.5, 679.5, 2.5, 0.89],
  [1106, 262, 3, 0.27],
  [1072.5, 208.5, 2.5, 0.34],
  [1096.5, 109.5, 1.5, 0.73],
  [816.5, 592.5, 3.5, 0.58],
  [595.5, 456.5, 1.5, 0.91],
  [1049, 338, 3, 0.81],
  [1187.5, 756.5, 3.5, 0.46],
  [419.5, 244.5, 2.5, 0.82],
  [974.5, 497.5, 2.5, 0.53],
  [702, 459, 2, 0.67],
  [964, 431, 3, 0.74],
  [908, 168, 3, 0.25],
  [950, 461, 2, 0.72],
  [1185, 68, 2, 0.88],
  [453, 253, 3, 0.91],
  [784, 827, 2, 0.74],
  [441, 259, 2, 0.35],
  [529, 116, 3, 0.63],
  [668, 575, 2, 0.52],
  [1198.5, 51.5, 1.5, 0.44],
  [455.5, 761.5, 3.5, 0.84],
  [1003.5, 850.5, 3.5, 0.73],
] as const;

const CONFETTI_COUNT = 56;
const BURST_AT = 0.95;
const CONTENT_AT = 1.15;

interface Piece {
  color: string;
  shape: "rect" | "circle";
  w: number;
  h: number;
  x: number[];
  y: number[];
  rotate: number[];
  duration: number;
}

/**
 * 종이폭죽: 초속도 + 중력 + 공기 저항으로 궤적을 미리 계산해 keyframes로 재생한다(데모와 같은 방식).
 * 위·옆으로 펑 → 금방 느려짐 → 좌우로 살랑이며 떨어지고 → 마지막에 사라진다.
 */
function makeConfetti(colors: string[]): Piece[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => {
    const angle = -Math.PI / 2 + (seeded(i, 1) - 0.5) * Math.PI * 1.1;
    const speed = 380 + seeded(i, 2) * 420;
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    let px = 0;
    let py = 0;
    const steps = 14;
    const dt = 0.12;
    const x = [0];
    const y = [0];
    for (let s = 1; s <= steps; s++) {
      vx *= 0.82;
      vy = vy * 0.82 + 900 * dt;
      px += vx * dt + Math.sin(s * 0.9 + i) * 6;
      py += vy * dt;
      x.push(Math.round(px));
      y.push(Math.round(py));
    }
    const spin = (seeded(i, 3) - 0.5) * 900;
    return {
      color: colors[i % colors.length],
      shape: seeded(i, 4) > 0.7 ? "circle" : "rect",
      w: 6 + Math.round(seeded(i, 5) * 6),
      h: 10 + Math.round(seeded(i, 6) * 14),
      x,
      y,
      rotate: x.map((_, s) => Math.round((spin * s) / steps)),
      duration: 1.6 + seeded(i, 7) * 0.8,
    };
  });
}

function Badge({ tier, size, icon }: { tier: StreakTier; size: number; icon: number }) {
  return (
    <span
      className="relative flex items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size, background: badgeGradient(tier) }}
    >
      <Image
        src={icon > 40 ? "/home/icon-flame-new.svg" : "/home/icon-flame-old.svg"}
        alt=""
        width={icon}
        height={icon}
      />
    </span>
  );
}

const item: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 380, damping: 26 } },
};

/**
 * S02-L 스트릭 레벨업 축하 (데모: 이정복/S02-L-레벨업-데모). Lottie 없이 Motion만 쓴다.
 * 이전 뱃지가 왼쪽으로 비켜나며 작아지고 → 새 뱃지가 오른쪽에서 따라와 가운데 →
 * 반짝(빛줄기 · 뱃지 콩 · 후광) + 종이폭죽 → LEVEL UP · 제목 · 설명 · 다음 단계 · [계속하기] 차례로 등장.
 *
 * 면접을 마치고 스트릭 단계가 올랐을 때(S08 흐름) 띄운다. 홈 진입 때는 쓰지 않는다.
 * 언제 띄울지·이미 봤는지는 쓰는 화면이 정하고, 닫힌 뒤 할 일은 onContinue로 받는다.
 */
export function LevelUp({ days, onContinue }: { days: number; onContinue?: () => void }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(true);
  useLockScroll(open);
  const tier = tierOf(days);
  const previous = previousTierOf(tier);
  const next = nextTierOf(tier);
  const confetti = useMemo(
    () => makeConfetti([tier.from, tier.to, next?.from ?? "#FFFFFF", "#FFFFFF"]),
    [tier, next],
  );

  const progress = next ? Math.max(0.07, (days - tier.min) / (next.min - tier.min)) : 1;
  const delay = (at: number) => (reduce ? 0 : at);

  return (
    <AnimatePresence onExitComplete={onContinue}>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="levelup-title"
          className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-night px-6"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* 후광: 둥근 글로우만 (사방으로 뻗는 빛살은 쓰지 않는다) */}
          <motion.span
            aria-hidden
            className="pointer-events-none absolute top-[-80px] left-1/2 size-[600px] -translate-x-1/2 rounded-full"
            style={{
              background: `radial-gradient(circle, ${withAlpha(tier.to, 0.35)}, ${withAlpha(tier.to, 0)} 70%)`,
            }}
            initial={{ opacity: 0.6, scale: 0.9 }}
            animate={
              reduce ? { opacity: 1 } : { opacity: [0.6, 0.7, 1, 0.8], scale: [0.9, 0.95, 1.25, 1] }
            }
            transition={{ duration: 1.6, times: [0, 0.55, 0.65, 1] }}
          />

          {/* 주변 불씨: 각자 다른 박자로 반짝이며 살짝 흔들린다 */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {EMBERS.map(([cx, cy, r, o], i) => (
              <motion.span
                key={i}
                className="absolute rounded-full"
                style={{
                  left: `${(cx / 1440) * 100}%`,
                  top: `${(cy / 900) * 100}%`,
                  width: r * 2,
                  height: r * 2,
                  background: tier.from,
                  opacity: o,
                }}
                animate={reduce ? undefined : { opacity: [o * 0.4, o, o * 0.4], y: [0, -4, 0] }}
                transition={{
                  duration: 2 + seeded(i, 8) * 2,
                  repeat: Infinity,
                  delay: seeded(i, 9) * 2,
                }}
              />
            ))}
          </div>

          <div className="relative flex flex-col items-center gap-5 text-center">
            {/* 뱃지: 이전(72, 흐림) » 새(148) */}
            <div className="flex items-center gap-7">
              <motion.span
                className="flex"
                initial={reduce ? false : { x: 194, scale: 2.05, opacity: 1 }}
                animate={{ x: 0, scale: 1, opacity: 0.45 }}
                transition={{ duration: 0.6, ease: "easeInOut", delay: delay(0.2) }}
              >
                <Badge tier={previous} size={72} icon={34} />
              </motion.span>
              <motion.span
                className="flex"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: delay(0.55) }}
              >
                <Image src="/home/icon-chevrons-right.svg" alt="" width={28} height={28} />
              </motion.span>
              <motion.span
                className="relative flex"
                initial={reduce ? false : { x: 320, opacity: 0, scale: 0.6 }}
                animate={
                  reduce
                    ? { x: 0, opacity: 1, scale: 1 }
                    : { x: 0, opacity: 1, scale: [0.6, 1, 1, 1.14, 1] }
                }
                transition={
                  reduce
                    ? undefined
                    : {
                        x: { type: "spring", stiffness: 160, damping: 18, delay: 0.3 },
                        opacity: { duration: 0.3, delay: 0.3 },
                        scale: { duration: 1.1, times: [0, 0.4, 0.6, 0.78, 1], delay: 0.3 },
                      }
                }
              >
                <span
                  className="relative flex size-[148px] items-center justify-center overflow-hidden rounded-full"
                  style={{
                    background: badgeGradient(tier),
                    boxShadow: `0 0 60px ${withAlpha(tier.to, 0.67)}`,
                  }}
                >
                  <Image
                    src="/home/icon-flame-new.svg"
                    alt=""
                    width={72}
                    height={72}
                    className="relative"
                  />
                  {!reduce && (
                    <motion.span
                      aria-hidden
                      className="absolute -top-9 left-0 h-[220px] w-6 rotate-30 bg-white/35"
                      initial={{ x: -120 }}
                      animate={{ x: 220 }}
                      transition={{ duration: 0.6, ease: "easeInOut", delay: BURST_AT }}
                    />
                  )}
                </span>
                {/* 종이폭죽: 뱃지 가운데에서 펑 */}
                {!reduce && (
                  <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2">
                    {confetti.map((piece, i) => (
                      <motion.span
                        key={i}
                        className={`absolute ${piece.shape === "circle" ? "rounded-full" : "rounded-[2px]"}`}
                        style={{
                          width: piece.w,
                          height: piece.shape === "circle" ? piece.w : piece.h,
                          background: piece.color,
                          marginLeft: -piece.w / 2,
                          marginTop: -piece.h / 2,
                        }}
                        initial={{ opacity: 0 }}
                        animate={{
                          x: piece.x,
                          y: piece.y,
                          rotate: piece.rotate,
                          opacity: piece.x.map((_, s, all) =>
                            s === 0 ? 1 : s > (all.length * 2) / 3 ? 0 : 1,
                          ),
                        }}
                        transition={{ duration: piece.duration, delay: BURST_AT, ease: "linear" }}
                      />
                    ))}
                  </span>
                )}
              </motion.span>
              {/* 가운데 맞춤용 빈자리 (Figma Balance) */}
              <span className="hidden w-[100px] sm:block" />
            </div>

            <motion.div
              className="flex flex-col items-center gap-5"
              initial="hidden"
              animate="show"
              transition={{ staggerChildren: 0.09, delayChildren: delay(CONTENT_AT) }}
            >
              <motion.span
                variants={item}
                className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] leading-normal font-extrabold tracking-[1px]"
                style={{ background: withAlpha(tier.to, 0.15), color: tier.from }}
              >
                <MaskIcon src="/home/icon-trophy-gold.svg" size={14} className="bg-current" />
                LEVEL UP · {days}일
              </motion.span>
              <motion.h2
                id="levelup-title"
                variants={item}
                className="text-[40px] leading-[1.3] font-extrabold tracking-[-1.4px] text-white sm:text-[60px] sm:tracking-[-2px]"
              >
                {tier.name} 달성!
              </motion.h2>
              <motion.p
                variants={item}
                className="text-[17px] leading-normal font-medium text-white/70 sm:text-[19px]"
              >
                {days}일 연속 연습 · 불꽃이 {tier.colorWord}으로 바뀌었어요
              </motion.p>
              <motion.div
                variants={item}
                className="flex w-full max-w-[440px] flex-col gap-3 rounded-[20px] border border-white/15 bg-white/8 p-5 text-left"
              >
                {next ? (
                  <>
                    <span className="flex items-center justify-between gap-3 leading-normal font-bold">
                      <span className="text-[15px] text-white">다음 단계 · {next.name}</span>
                      <span className="text-sm" style={{ color: next.from }}>
                        {next.min - days}일 남음
                      </span>
                    </span>
                    <span className="relative h-2 overflow-hidden rounded-full bg-white/15">
                      <motion.span
                        className="absolute inset-y-0 left-0 origin-left rounded-full"
                        style={{
                          width: `${progress * 100}%`,
                          background: `linear-gradient(90deg, ${tier.from}, ${next.from})`,
                        }}
                        initial={{ scaleX: reduce ? 1 : 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{
                          duration: 0.8,
                          ease: "easeOut",
                          delay: delay(CONTENT_AT + 0.5),
                        }}
                      />
                    </span>
                  </>
                ) : (
                  <span className="text-[15px] leading-normal font-bold text-white">
                    2주 완주! 모든 단계를 달성했어요
                  </span>
                )}
              </motion.div>
              <motion.button
                variants={item}
                type="button"
                onClick={() => setOpen(false)}
                autoFocus
                className="flex h-[60px] w-[280px] cursor-pointer items-center justify-center rounded-2xl bg-white px-6 text-lg leading-normal font-bold text-[#191f28]"
              >
                계속하기
              </motion.button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
