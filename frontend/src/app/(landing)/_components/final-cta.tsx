"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";

import { ROUTES } from "@/lib/routes";

import { Embers, Reveal, type Ember } from "./motion-utils";

// Figma "CTA Embers (animated)" 18개 (1440×520 기준)
const CTA_EMBERS: readonly Ember[] = [
  [727.5, 291.5, 1.5, 0.32],
  [1047, 255, 3, 0.57],
  [54.5, 302.5, 2.5, 0.59],
  [1057.5, 415.5, 1.5, 0.78],
  [14.5, 480.5, 1.5, 0.49],
  [507, 121, 3, 0.87],
  [1133, 355, 3, 0.85],
  [1342, 297, 2, 0.53],
  [569, 385, 2, 0.8],
  [281.5, 184.5, 1.5, 0.73],
  [279, 418, 2, 0.58],
  [1013.5, 478.5, 3.5, 0.73],
  [1317, 278, 2, 0.62],
  [650.5, 63.5, 2.5, 0.23],
  [840, 499, 2, 0.88],
  [865, 448, 2, 0.84],
  [440, 211, 3, 0.63],
  [1042, 126, 3, 0.25],
];

export function FinalCta() {
  const reduce = useReducedMotion();
  const drift = (dir: 1 | -1) =>
    reduce ? undefined : { x: [0, 40 * dir, 0, -40 * dir, 0], y: [0, -40 * dir, 0, 40 * dir, 0] };

  return (
    <section className="relative flex h-[520px] flex-col items-center justify-center gap-8 overflow-hidden bg-night-2 px-6">
      <motion.div
        aria-hidden
        className="pointer-events-none absolute top-[-220px] left-[-160px] size-[720px]"
        animate={drift(1)}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      >
        <Image src="/landing/cta-glow-orange.svg" alt="" width={720} height={720} />
      </motion.div>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute top-10 left-[66.7%] size-[680px]"
        animate={drift(-1)}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      >
        <Image src="/landing/cta-glow-blue.svg" alt="" width={680} height={680} />
      </motion.div>
      <Embers embers={CTA_EMBERS} width={1440} height={520} />

      <Reveal className="relative flex flex-col items-center gap-8">
        <h2 className="text-center text-[36px] leading-[1.25] font-extrabold tracking-[-1.2px] text-white lg:text-[56px] lg:tracking-[-1.6px]">
          오늘부터 1일째,
          <br />
          시작해볼까요?
        </h2>
        <motion.div
          className="rounded-2xl"
          animate={
            reduce
              ? undefined
              : {
                  boxShadow: [
                    "0 0 24px rgba(255,122,38,0.35)",
                    "0 0 40px rgba(255,122,38,0.6)",
                    "0 0 24px rgba(255,122,38,0.35)",
                  ],
                }
          }
          whileHover={{ scale: 1.04 }}
          transition={{ boxShadow: { duration: 2, repeat: Infinity, ease: "easeInOut" } }}
        >
          <Link
            href={ROUTES.signup}
            className="flex h-[60px] items-center gap-2 rounded-2xl bg-brand-strong px-8 text-lg font-bold text-white"
          >
            무료로 시작하기
            <Image src="/landing/icon-arrow-right.svg" alt="" width={20} height={20} />
          </Link>
        </motion.div>
        <p className="text-base leading-normal font-medium text-white/60">
          SSAFY 교육생이라면 지금 바로 무료
        </p>
      </Reveal>
    </section>
  );
}
