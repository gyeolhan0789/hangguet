"use client";

import { motion, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import Image from "next/image";
import { useEffect, useRef } from "react";

// 기준: Figma S05 Camera Preview(18:2381: 600×430 · #1b1f2a · 둥글기 24 · 가운데 user-round 180)
// · Live Chip(18:2385: rec dot 8 · '카메라 연결됨' 13 Bold 흰색) · Mic Level(18:2388: 아래 20px · 높이 44 · 막대 24개 6px
// · 켜진 막대 brand · 꺼진 막대 흰색 20%) · 모션 메모 S05(18:2492: 마이크 레벨은 실제 입력 볼륨에 맞춰 막대 높이 실시간)

/** 막대 수(Figma Bars 24개) */
export const LEVEL_BARS = 24;
/** 켜진 막대 높이(Figma 켜진 막대 13개의 높이를 차례로 되풀이) */
const LIT_HEIGHTS = [10, 16, 22, 14, 26, 30, 20, 12, 24, 18, 28, 16, 10];
/** 꺼진 막대는 6px 점. 켜진 막대 바로 다음 하나는 8px(Figma 14번째 막대) */
const OFF_HEIGHT = 6;
const EDGE_HEIGHT = 8;
/** 소리가 작을 때 켜진 막대가 줄어드는 정도. 높이 = 패턴 높이 × (최소 비율 + 나머지 × 소리 크기) */
const MIN_HEIGHT_RATIO = 0.5;

/** 카메라 미리보기. 카메라 · 마이크가 확인되면 영상 · 연결 표시 · 소리 크기 막대를 보여 준다. */
export function CameraPreview({
  stream,
  cameraOn,
  micOn,
  level,
}: {
  stream: MediaStream | null;
  cameraOn: boolean;
  micOn: boolean;
  level: MotionValue<number>;
}) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (video.current) video.current.srcObject = cameraOn ? stream : null;
  }, [stream, cameraOn]);

  return (
    <div className="relative aspect-[600/430] w-full shrink-0 overflow-hidden rounded-3xl bg-[#1b1f2a] lg:aspect-auto lg:h-[430px] lg:w-[600px]">
      <div className="absolute inset-0 flex items-center justify-center pb-[50px]">
        <Image
          src="/devices/user-round.svg"
          alt=""
          width={180}
          height={180}
          // 정사각형을 지키도록 가로(미리보기의 30% = Figma 180/600)만 정하고 세로는 비율대로 둔다.
          className="h-auto w-[30%] lg:size-[180px]"
        />
      </div>
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        aria-label="내 카메라 화면"
        // 거울처럼 좌우를 뒤집어 보여 준다.
        className={`absolute inset-0 size-full -scale-x-100 object-cover ${cameraOn ? "" : "hidden"}`}
      />

      {cameraOn && (
        <div className="absolute top-5 left-5 flex items-center gap-1.5 rounded-full bg-[rgba(14,16,22,0.7)] px-3 py-2">
          <motion.span
            aria-hidden
            className="flex"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          >
            <Image src="/devices/rec-dot.svg" alt="" width={8} height={8} />
          </motion.span>
          <span className="text-[13px] leading-normal font-bold tracking-[-0.2px] text-white">
            카메라 연결됨
          </span>
        </div>
      )}

      {micOn && (
        <div className="absolute right-5 bottom-5 left-5 flex h-11 items-center gap-3 rounded-[14px] bg-[rgba(14,16,22,0.7)] px-4">
          <Image src="/devices/icon-mic-white.svg" alt="" width={18} height={18} />
          <LevelMeter level={level} />
          <span className="shrink-0 text-[13px] leading-normal font-semibold tracking-[-0.2px] whitespace-nowrap text-white/70">
            목소리가 잘 들려요
          </span>
        </div>
      )}
    </div>
  );
}

/** 소리 크기 막대 묶음. 보조기기와 테스트가 읽을 수 있게 소리 크기(0~100)를 meter 값으로도 둔다. */
function LevelMeter({ level }: { level: MotionValue<number> }) {
  const meter = useRef<HTMLDivElement>(null);
  // 매 프레임 바뀌므로 리렌더 없이 속성만 고친다. 값이 10 단위로 바뀔 때만 쓴다.
  useMotionValueEvent(level, "change", (value) => {
    const now = String(Math.round(value * 10) * 10);
    if (meter.current && meter.current.getAttribute("aria-valuenow") !== now) {
      meter.current.setAttribute("aria-valuenow", now);
    }
  });
  return (
    <div
      ref={meter}
      role="meter"
      aria-label="마이크 소리 크기"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      className="flex min-w-0 items-center gap-1 overflow-hidden"
    >
      {Array.from({ length: LEVEL_BARS }, (_, i) => (
        <LevelBar key={i} index={i} level={level} />
      ))}
    </div>
  );
}

/** 소리 크기 막대 하나. 소리가 클수록 왼쪽부터 더 많은 막대가 켜진다. */
function LevelBar({ index, level }: { index: number; level: MotionValue<number> }) {
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
