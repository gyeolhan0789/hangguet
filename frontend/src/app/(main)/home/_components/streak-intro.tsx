"use client";

import {
  animate,
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  type AnimationPlaybackControlsWithThen,
} from "motion/react";
import { useEffect, useRef, useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { useLockScroll } from "@/components/use-lock-scroll";
import { introCopy } from "@/lib/home/intro";
import type { HomeResponse } from "@/lib/home/types";
import { tierOf } from "@/lib/streak";

import { HomeSkeleton } from "./home-skeleton";

const EASE_WIPE = [0.65, 0, 0.35, 1] as const;
/** 전체 재생 속도 배율 (1.2 = 데모보다 1.2배 빠르게). 아래 시간은 모두 이 값으로 나눈다. */
const SPEED = 1.2;
const t = (seconds: number) => seconds / SPEED;
/** 뿅 등장 뒤 어제 숫자(N-1)를 보여 주는 시간 */
const BEFORE_ROLL_S = t(0.45);
/** 숫자가 N-1 → N으로 굴러 바뀌는 시간 */
const ROLL_S = t(0.55);
/** 바뀐 숫자를 보여 주는 시간 */
const HOLD_S = t(0.5);

const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/**
 * S02-1 홈 진입 인트로 (데모: 이정복/S02-1-전환-데모). Lottie 없이 Motion만 쓴다.
 * ① 홈 스켈레톤 위로 스트릭 단계 색 원이 오른쪽 밖에서 들어와 화면을 덮고
 * ② 'N-1일째!'가 뿅 등장 → 숫자가 위로 굴러 N으로 바뀜 → 잠깐 멈춤 → 확대·블러로 사라짐
 * ③ 원이 왼쪽 밖으로 빠지며 뒤의 홈이 드러난다. 홈에 들어올 때마다 재생한다.
 */
export function StreakIntro({ home }: { home: HomeResponse }) {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [covered, setCovered] = useState(false);
  useLockScroll(visible);
  const overlayRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  const tier = tierOf(home.currentStreak);
  const copy = introCopy(home);

  // 원 크기는 화면 대각선 절반으로 고정하고 중심 x만 옮겨서, 둥근 가장자리가 화면을 쓸고 지나가게 한다.
  const radius = useMotionValue(0);
  const centerX = useMotionValue(0);
  const clipPath = useMotionTemplate`circle(${radius}px at ${centerX}px 50%)`;
  const [shownCount, setShownCount] = useState(Math.max(0, (copy.count ?? 0) - 1));

  useEffect(() => {
    let cancelled = false;
    // 화면을 벗어나면(언마운트) 진행 중인 애니메이션을 모두 멈춘다.
    const stops: AnimationPlaybackControlsWithThen[] = [];
    const run = (controls: AnimationPlaybackControlsWithThen) => {
      stops.push(controls);
      return controls;
    };

    async function play() {
      if (reduce) {
        if (overlayRef.current)
          await run(animate(overlayRef.current, { opacity: 0 }, { duration: t(0.3) }));
        if (!cancelled) setVisible(false);
        return;
      }
      const width = window.innerWidth;
      const r = Math.ceil(Math.hypot(width, window.innerHeight) / 2) + 2;
      radius.set(r);
      centerX.set(width + r);

      await run(animate(centerX, width / 2, { duration: t(0.9), ease: EASE_WIPE }));
      if (cancelled) return;
      setCovered(true);

      const badge = badgeRef.current;
      if (!badge) return;
      await run(
        animate(
          badge,
          { opacity: [0, 1, 1], scale: [0.55, 1.12, 1] },
          { duration: t(0.48), times: [0, 0.65, 1], ease: [0.2, 0.9, 0.3, 1.2] },
        ),
      );
      if (copy.count !== null) {
        await wait(BEFORE_ROLL_S);
        if (cancelled) return;
        setShownCount(copy.count);
        await wait(ROLL_S);
      }
      await wait(HOLD_S);
      if (cancelled) return;
      await run(
        animate(
          badge,
          { opacity: 0, scale: 1.35, filter: ["blur(0px)", "blur(8px)"] },
          { duration: t(0.34), ease: [0.4, 0, 1, 1] },
        ),
      );
      await run(animate(centerX, -r, { duration: t(0.75), ease: EASE_WIPE }));
      if (!cancelled) setVisible(false);
    }

    void play();
    return () => {
      cancelled = true;
      stops.forEach((controls) => controls.stop());
    };
  }, [reduce, copy.count, centerX, radius]);

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      role="status"
      aria-label={`${copy.count ?? ""}${copy.text} ${copy.sub}`}
      className="fixed inset-0 z-[70] overflow-hidden"
    >
      {!covered && (
        <div className="absolute inset-0 overflow-hidden bg-bg">
          <HomeSkeleton withHeader />
        </div>
      )}
      <motion.div className="absolute inset-0" style={{ background: tier.wipe, clipPath }} />
      <div
        ref={badgeRef}
        aria-hidden
        className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center opacity-0"
        style={{ color: tier.ink }}
      >
        <MaskIcon src="/home/icon-flame-badge.svg" size={64} className="bg-current" />
        <p className="text-[72px] leading-none font-extrabold tracking-[-0.05em] sm:text-[120px]">
          {copy.count !== null && (
            // 숫자 굴리기: 이전 숫자는 위로 빠지고 새 숫자가 아래에서 올라온다.
            // 좁은 자간 때문에 글자가 칸 밖으로 나오므로 가로는 자르지 않고 세로만 자른다.
            // 숫자 폭을 같게(tabular-nums) 해서 바뀌어도 뒤 글씨가 밀리지 않게 한다.
            <span className="relative inline-flex overflow-y-clip align-bottom tabular-nums">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={shownCount}
                  className="inline-block"
                  initial={{ y: "100%", opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: "-100%", opacity: 0 }}
                  transition={{ duration: ROLL_S, ease: [0.22, 1, 0.36, 1] }}
                >
                  {shownCount}
                </motion.span>
              </AnimatePresence>
            </span>
          )}
          {copy.text}
        </p>
        <p className="text-lg font-bold opacity-90 sm:text-2xl">{copy.sub}</p>
      </div>
    </div>
  );
}
