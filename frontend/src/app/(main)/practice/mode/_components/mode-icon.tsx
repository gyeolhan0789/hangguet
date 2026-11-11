"use client";

import { motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { modeInfo } from "@/lib/interview/modes";
import type { Mode } from "@/types/api";

// 기준: Figma S05-1 Icon Tile(18:2272: 56px · 둥근 16 · bg-sub, 아이콘 28px — 고른 카드 brand-ink, 안 고른 카드 text-2)
// · 모션 메모 S05-1(18:2328): 고른 카드만 재생, 해제되면 정지
//   공통: 고른 순간 타일 통통 — y [0,-8,0] + scale [1,1.1,1] · spring(500, 14)
//   화상: 렌즈 옆 빨간 녹화 점 opacity [1,.3,1] 1.2s 반복 · 아이콘 좌우 패닝 rotate [-4,4,0] 0.6s 한 번
//   채팅: 말풍선 안 점 3개 타이핑 y [0,-3,0] stagger 0.15s 반복 · 말풍선 scale [1,1.08,1] 한 번
//   다른 카드로 바꾸면 이전 아이콘은 scale 1→0.95→1로 조용히 정지 · 동작 줄이기면 반복 없이 색만 바뀜

const TILE_SPRING = { type: "spring", stiffness: 500, damping: 14 } as const;
const DOTS = [0, 1, 2];

export function ModeIcon({ mode, active }: Readonly<{ mode: Mode; active: boolean }>) {
  const [tile, animateTile] = useAnimate<HTMLSpanElement>();
  const [icon, animateIcon] = useAnimate<HTMLSpanElement>();
  const reduce = useReducedMotion();
  const wasActive = useRef(active);

  useEffect(() => {
    const changed = wasActive.current !== active;
    wasActive.current = active;
    if (!changed || reduce || !tile.current || !icon.current) return;
    if (active) {
      // 스프링은 키프레임 두 개만 받으므로 [0,-8,0]을 위로 → 제자리 두 번으로 나눈다.
      animateTile([
        [tile.current, { y: -8, scale: 1.1 }, TILE_SPRING],
        [tile.current, { y: 0, scale: 1 }, TILE_SPRING],
      ]);
      animateIcon(
        icon.current,
        mode === "VIDEO" ? { rotate: [-4, 4, 0] } : { scale: [1, 1.08, 1] },
        { duration: 0.6 },
      );
    } else {
      // 이전 아이콘은 조용히 멈춘다(모션 메모: 아이콘 scale 1→0.95→1). 길이 0.3s는 메모에 없어 정했다.
      animateIcon(icon.current, { scale: [1, 0.95, 1] }, { duration: 0.3 });
    }
  }, [active, reduce, mode, animateTile, animateIcon, tile, icon]);

  const color = active ? "bg-brand-ink" : "bg-text-2";
  const looping = active && !reduce;

  return (
    <span
      ref={tile}
      className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-bg-sub"
    >
      <span ref={icon} className="relative flex size-7">
        <MaskIcon src={modeInfo(mode).icon} size={28} className={`${color} transition-colors`} />
        {looping && mode === "VIDEO" && (
          // 렌즈 옆 녹화 점(위치는 Figma에 없어 카메라 몸통 오른쪽 위에 둔다)
          <motion.span
            aria-hidden
            data-testid="recording-dot"
            className="absolute top-[9px] left-[13px] size-[5px] rounded-full bg-danger"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        )}
        {looping &&
          mode === "CHAT" &&
          DOTS.map((i) => (
            <motion.span
              key={i}
              aria-hidden
              data-testid="typing-dot"
              className={`absolute top-[11.5px] size-[3px] rounded-full ${color}`}
              style={{ left: 8 + i * 4.75 }}
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 0.3, delay: i * 0.15 }}
            />
          ))}
      </span>
    </span>
  );
}
