"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";

import { PERSONAS } from "@/lib/interview/personas";
import type { Persona } from "@/types/api";

// 기준: Figma S06-1 Thinking Avatar(18:4441: 132 · Ring Track · Spinner Arc(오른쪽 위 호) · Avatar 108(가운데 · 둥근))
// · 모션 메모 S06-1(18:4469: 아바타 둘레 주황 호 rotate 0→360 · 1.2s linear 루프)
// · Swagger 5.1 Persona · S04 면접관 썸네일(PERSONAS avatar)
// S06-1 결과 분석 중과 면접관 3D를 불러오는 동안 같이 쓴다.

/** 면접관 썸네일 둘레를 주황 호가 도는 표시 */
export function ThinkingAvatar({ persona }: Readonly<{ persona: Persona }>) {
  const reduce = useReducedMotion();
  const info = PERSONAS.find((item) => item.persona === persona);
  return (
    <span className="relative block size-[132px] shrink-0">
      <Image
        src="/interview/ring-track.svg"
        alt=""
        width={132}
        height={132}
        loading="eager"
        className="absolute inset-0"
      />
      <motion.span
        aria-hidden
        data-testid="thinking-spinner"
        className="absolute inset-0"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 1.2, ease: "linear", repeat: Infinity }}
      >
        <Image
          src="/interview/spinner-arc.svg"
          alt=""
          // Figma 호 크기 66×88.5733. 정수만 받는 width · height 대신 크기는 클래스로 맞춘다.
          width={66}
          height={89}
          loading="eager"
          className="absolute top-0 left-1/2 h-[88.5733px] w-[66px]"
        />
      </motion.span>
      {info && (
        <Image
          src={info.avatar}
          alt={info.name}
          width={108}
          height={108}
          loading="eager"
          className="absolute top-3 left-3 size-[108px] rounded-full object-cover"
        />
      )}
    </span>
  );
}
