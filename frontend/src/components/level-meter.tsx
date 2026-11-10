"use client";

import { motion, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { useRef } from "react";

// 마이크 소리 크기 막대. S05 장치 점검 카메라 미리보기와 S06 [마이크 확인] 미니 모달이 같이 쓴다.
// 기준: Figma S05 Mic Level(18:2388: 막대 24개 6px · 켜진 막대 brand · 꺼진 막대 흰색 20%, 어두운 바탕 위)
// · 모션 메모 S05(18:2492: 마이크 레벨은 실제 입력 볼륨에 맞춰 막대 높이 실시간)

/** 막대 수(Figma Bars 24개) */
export const LEVEL_BARS = 24;
/** 켜진 막대 높이(Figma 켜진 막대 13개의 높이를 차례로 되풀이) */
const LIT_HEIGHTS = [10, 16, 22, 14, 26, 30, 20, 12, 24, 18, 28, 16, 10];
/** 꺼진 막대는 6px 점. 켜진 막대 바로 다음 하나는 8px(Figma 14번째 막대) */
const OFF_HEIGHT = 6;
const EDGE_HEIGHT = 8;
/** 소리가 작을 때 켜진 막대가 줄어드는 정도. 높이 = 패턴 높이 × (최소 비율 + 나머지 × 소리 크기) */
const MIN_HEIGHT_RATIO = 0.5;

/**
 * 소리 크기 막대 묶음. 보조기기와 테스트가 읽을 수 있게 소리 크기(0~100)를 화면에 보이지 않는 네이티브 <meter> 값으로도 둔다
 * (ARIA meter 역할 대신 네이티브 요소 — 소나 S6819). 보이는 막대는 장식이다.
 */
export function LevelMeter({ level }: Readonly<{ level: MotionValue<number> }>) {
  const meter = useRef<HTMLMeterElement>(null);
  // 매 프레임 바뀌므로 리렌더 없이 값만 고친다. 값이 10 단위로 바뀔 때만 쓴다.
  useMotionValueEvent(level, "change", (value) => {
    const now = Math.round(value * 10) * 10;
    if (meter.current && meter.current.value !== now) meter.current.value = now;
  });
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      <meter
        ref={meter}
        aria-label="마이크 소리 크기"
        min={0}
        max={100}
        value={0}
        className="sr-only"
      />
      {Array.from({ length: LEVEL_BARS }, (_, i) => (
        <LevelBar key={i} index={i} level={level} />
      ))}
    </div>
  );
}

/** 소리 크기 막대 하나. 소리가 클수록 왼쪽부터 더 많은 막대가 켜진다. */
function LevelBar({ index, level }: Readonly<{ index: number; level: MotionValue<number> }>) {
  const lit = (value: number) => value * LEVEL_BARS > index;
  // 켜진 막대는 소리 크기에 따라 높이도 함께 바뀐다(모션 메모: 실제 입력 볼륨에 맞춰 막대 높이 실시간).
  const height = useTransform(level, (value) => {
    if (lit(value)) {
      const pattern = LIT_HEIGHTS[index % LIT_HEIGHTS.length];
      return Math.max(OFF_HEIGHT, pattern * (MIN_HEIGHT_RATIO + (1 - MIN_HEIGHT_RATIO) * value));
    }
    return index > 0 && lit(value + 1 / LEVEL_BARS) ? EDGE_HEIGHT : OFF_HEIGHT;
  });
  const backgroundColor = useTransform(level, (value) =>
    lit(value) ? "var(--color-brand)" : "rgba(255,255,255,0.2)",
  );
  return (
    <motion.span
      aria-hidden
      className="w-1.5 shrink-0 rounded-full"
      style={{ height, backgroundColor }}
    />
  );
}
