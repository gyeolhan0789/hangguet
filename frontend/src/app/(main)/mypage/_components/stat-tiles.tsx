"use client";

import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  type Variants,
} from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { formatMinutes } from "@/lib/user/calendar";
import type { StatsResponse } from "@/types/api";

// 기준: Figma S09 Stats(18:2891: 4열 · 간격 20 · 카드 bg-sub · 둥글기 20 · 패딩 24 · 간격 14 · 타일 44 · 둥글기 12 · 아이콘 22
// · 숫자 28 ExtraBold 행간 1.3 · 이름 14 SemiBold text-3) · Swagger 3.2 통계(StatsResponse) · 모션 메모 S09(18:3109: 숫자 카운트업
// (0→값, 0.8s) + stagger 0.06s 등장)

interface Tile {
  label: string;
  value: number;
  format: (value: number) => string;
  /** 타일 배경(라이트 · 다크 Figma 변수 값) */
  tone: string;
  icon: { src: string; mask?: string };
}

function tilesOf(stats: StatsResponse): Tile[] {
  return [
    {
      label: "현재 스트릭",
      value: stats.currentStreak,
      format: (v) => `${v}일`,
      tone: "bg-gold-soft dark:bg-gold-soft/9",
      icon: { src: "/mypage/icon-flame.svg" },
    },
    {
      label: "최장 스트릭",
      value: stats.bestStreak,
      format: (v) => `${v}일`,
      tone: "bg-brand-soft dark:bg-brand-soft/8",
      icon: { src: "/mypage/icon-trophy.svg", mask: "bg-brand-ink" },
    },
    {
      label: "총 면접",
      value: stats.totalInterviewCount,
      format: (v) => `${v}회`,
      tone: "bg-blue-soft dark:bg-blue-soft/15",
      icon: { src: "/mypage/icon-mic.svg" },
    },
    {
      label: "총 연습 시간",
      value: stats.totalPracticeMinutes,
      format: formatMinutes,
      tone: "bg-success-soft dark:bg-success-soft/14",
      icon: { src: "/mypage/icon-timer.svg", mask: "bg-success" },
    },
  ];
}

const list: Variants = { shown: { transition: { staggerChildren: 0.06 } } };
const item: Variants = { hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } };

export function StatTiles({ stats }: Readonly<{ stats: StatsResponse }>) {
  const reduce = useReducedMotion();
  return (
    <motion.ul
      aria-label="통계"
      className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4"
      variants={list}
      initial={reduce ? false : "hidden"}
      animate="shown"
    >
      {tilesOf(stats).map((tile) => (
        <motion.li
          key={tile.label}
          variants={item}
          className="flex min-w-0 flex-col items-start gap-3.5 rounded-[20px] bg-bg-sub p-5 sm:p-6"
        >
          <span className={`flex size-11 items-center justify-center rounded-xl ${tile.tone}`}>
            {tile.icon.mask ? (
              <MaskIcon src={tile.icon.src} size={22} className={tile.icon.mask} />
            ) : (
              <Image src={tile.icon.src} alt="" width={22} height={22} />
            )}
          </span>
          <span className="flex flex-col gap-0.5 whitespace-nowrap">
            <CountUp value={tile.value} format={tile.format} />
            <span className="text-sm leading-normal font-semibold tracking-[-0.2px] text-text-3">
              {tile.label}
            </span>
          </span>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/** 0에서 값까지 0.8초 동안 세어 올라간다. 동작 줄이기면 바로 값을 보여 준다. */
function CountUp({
  value,
  format,
}: Readonly<{ value: number; format: (value: number) => string }>) {
  const reduce = useReducedMotion();
  const count = useMotionValue(reduce ? value : 0);
  const [shown, setShown] = useState(() => (reduce ? value : 0));

  useMotionValueEvent(count, "change", (latest) => setShown(Math.round(latest)));

  useEffect(() => {
    if (reduce) {
      count.jump(value);
      return;
    }
    const controls = animate(count, value, { duration: 0.8, ease: "easeOut" });
    return () => controls.stop();
  }, [value, reduce, count]);

  return (
    <span className="text-[28px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
      {/* 세는 동안에도 화면 읽기 프로그램은 최종 값을 읽는다. */}
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
