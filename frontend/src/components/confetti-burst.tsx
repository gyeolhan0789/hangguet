"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

import { seeded } from "@/lib/seeded";

// 종이폭죽(종이대포). 기준: S02-L 레벨업 데모(이정복/S02-L-레벨업-데모)의 종이폭죽 — S02-L 레벨업 · S08 성장 리뷰 축하가 같이 쓴다.
// · 모션 메모 S08(18:2843: 배지 등장과 함께 색종이 6~20개 터짐)

interface Piece {
  /** 몇 번째 조각인지(궤적 · 모양을 정하는 씨앗). 조각마다 다르다 */
  id: number;
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
 * 초속도 + 중력 + 공기 저항으로 궤적을 미리 계산해 keyframes로 재생한다(데모와 같은 방식).
 * 위 · 옆으로 펑 → 금방 느려짐 → 좌우로 살랑이며 떨어지고 → 마지막에 사라진다.
 * power는 터지는 세기(1이면 레벨업 크기)다.
 */
export function makeConfetti(colors: readonly string[], count: number, power = 1): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (seeded(i, 1) - 0.5) * Math.PI * 1.1;
    const speed = (380 + seeded(i, 2) * 420) * power;
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
      id: i,
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

/**
 * 감싼 요소의 가운데에서 종이폭죽을 한 번 터뜨린다. 동작 줄이기면 그리지 않는다.
 * 부모는 position: relative여야 한다.
 */
export function ConfettiBurst({
  colors,
  count,
  power = 1,
  delay = 0,
}: Readonly<{
  colors: readonly string[];
  count: number;
  power?: number;
  /** 터지는 때(초) */
  delay?: number;
}>) {
  const reduce = useReducedMotion();
  const pieces = useMemo(() => makeConfetti(colors, count, power), [colors, count, power]);
  if (reduce) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2">
      {pieces.map((piece) => (
        <motion.span
          key={piece.id}
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
            // 마지막 3분의 1 동안 사라진다
            opacity: piece.x.map((_, s, all) => (s > (all.length * 2) / 3 ? 0 : 1)),
          }}
          transition={{ duration: piece.duration, delay, ease: "linear" }}
        />
      ))}
    </span>
  );
}
