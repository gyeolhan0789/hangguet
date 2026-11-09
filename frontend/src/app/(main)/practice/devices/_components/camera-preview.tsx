"use client";

import { motion, type MotionValue } from "motion/react";
import Image from "next/image";
import { useEffect, useRef } from "react";

import { LevelMeter } from "@/components/level-meter";

// 기준: Figma S05 Camera Preview(18:2381: 600×430 · #1b1f2a · 둥글기 24 · 가운데 user-round 180)
// · Live Chip(18:2385: rec dot 8 · '카메라 연결됨' 13 Bold 흰색) · Mic Level(18:2388: 아래 20px · 높이 44 · 막대 24개 6px
// · 켜진 막대 brand · 꺼진 막대 흰색 20%) · 모션 메모 S05(18:2492: 마이크 레벨은 실제 입력 볼륨에 맞춰 막대 높이 실시간)

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
