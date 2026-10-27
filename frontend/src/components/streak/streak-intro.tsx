"use client";

import {
  animate,
  AnimatePresence,
  delay,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  type AnimationPlaybackControlsWithThen,
} from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { useLockScroll } from "@/components/use-lock-scroll";
import type { StreakTier } from "@/lib/streak";

const EASE_WIPE = [0.65, 0, 0.35, 1] as const;
/** 전체 재생 속도 배율 (1.2 = 데모보다 1.2배 빠르게). 아래 시간은 모두 이 값으로 나눈다. */
const SPEED = 1.2;
const t = (seconds: number) => seconds / SPEED;
/** 뿅 등장 뒤 이전 숫자(N-1)를 보여 주는 시간 */
const BEFORE_ROLL_S = t(0.45);
/** 숫자가 N-1 → N으로 굴러 바뀌는 시간 */
const ROLL_S = t(0.55);
/** 바뀐 숫자를 보여 주는 시간 */
const HOLD_S = t(0.5);

export interface IntroCopy {
  /** 카운트업할 숫자. 없으면 text만 보여 준다. */
  count: number | null;
  /** 숫자 뒤에 붙는 말 (count가 없으면 문구 전체) */
  text: string;
  sub: string;
}

/**
 * 스트릭 불 전환 (데모: 이정복/S02-1-전환-데모). Lottie 없이 Motion만 쓴다.
 * ① 뒤 화면 위로 스트릭 단계 색 원이 오른쪽 밖에서 들어와 화면을 덮고
 * ② 'N-1일째!'가 뿅 등장 → 숫자가 위로 굴러 N으로 바뀜 → 잠깐 멈춤 → 확대·블러로 사라짐
 * ③ 원이 왼쪽 밖으로 빠지며 뒤 화면이 드러난다. stayCovered면 ③ 없이 덮은 채로 끝낸다.
 * 홈 진입 인트로(S02-1)와 면접을 마친 뒤 'N일째 달성!'(StreakCelebration)이 같이 쓴다.
 */
export function StreakIntro({
  tier,
  copy,
  backdrop,
  stayCovered = false,
  onDone,
}: {
  tier: StreakTier;
  copy: IntroCopy;
  /** 원이 덮기 전까지 보이는 화면(예: 홈 스켈레톤). 없으면 지금 화면이 그대로 비친다. */
  backdrop?: ReactNode;
  /** 끝난 뒤 원을 걷지 않고 덮은 채로 둔다(이어서 레벨업을 띄울 때) */
  stayCovered?: boolean;
  onDone?: () => void;
}) {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [covered, setCovered] = useState(false);
  useLockScroll(visible);
  const overlayRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // 원 크기는 화면 대각선 절반으로 고정하고 중심 x만 옮겨서, 둥근 가장자리가 화면을 쓸고 지나가게 한다.
  const radius = useMotionValue(0);
  const centerX = useMotionValue(0);
  const clipPath = useMotionTemplate`circle(${radius}px at ${centerX}px 50%)`;
  const [shownCount, setShownCount] = useState(Math.max(0, (copy.count ?? 0) - 1));

  useEffect(() => {
    let cancelled = false;
    // 화면을 벗어나면(언마운트) 진행 중인 애니메이션을 모두 멈춘다.
    const stops: (() => void)[] = [];
    const run = (controls: AnimationPlaybackControlsWithThen) => {
      stops.push(() => controls.stop());
      return controls;
    };
    // 멈춰 있는 시간도 Motion의 프레임 루프(delay)로 재서, 애니메이션과 같은 시계로 흐르게 한다.
    // motion/react의 delay는 밀리초 단위다.
    const wait = (seconds: number) =>
      new Promise<void>((resolve) => {
        stops.push(delay(() => resolve(), seconds * 1000));
      });
    const finish = () => {
      if (cancelled) return;
      if (!stayCovered) setVisible(false);
      onDoneRef.current?.();
    };

    async function play() {
      if (reduce) {
        if (!stayCovered && overlayRef.current)
          await run(animate(overlayRef.current, { opacity: 0 }, { duration: t(0.3) }));
        finish();
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
      if (!stayCovered) await run(animate(centerX, -r, { duration: t(0.75), ease: EASE_WIPE }));
      finish();
    }

    void play();
    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
  }, [reduce, copy.count, centerX, radius, stayCovered]);

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      role="status"
      aria-label={`${copy.count ?? ""}${copy.text} ${copy.sub}`}
      className="fixed inset-0 z-[70] overflow-hidden"
    >
      {!covered && backdrop && (
        <div className="absolute inset-0 overflow-hidden bg-bg">{backdrop}</div>
      )}
      <motion.div
        data-testid="streak-wipe"
        className="absolute inset-0"
        style={{ background: tier.wipe, clipPath }}
      />
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
