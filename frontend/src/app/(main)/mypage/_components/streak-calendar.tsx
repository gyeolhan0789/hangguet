"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { buildCalendar, monthLabel, shiftMonth, type CalendarDay } from "@/lib/user/calendar";
import { mypagePath, recordsPath } from "@/lib/routes";

// 기준: Figma S09 Streak Calendar(18:2930: 폭 560 · bg-sub · 둥글기 24 · 패딩 24 · 간격 12 · '스트릭 달력' 18 ExtraBold
// · ‹ 2026년 10월 › 15 Bold · 요일 13 SemiBold text-3 · 칸 높이 40 · 동그라미 34 · 연습한 날 brand-strong · 13 ExtraBold 흰색
// · 띠(band) 높이 32 · 오늘 brand 2px 테두리 · brand-ink · 지난날 13 Medium text-2 · 앞날 text-3(누를 수 없음)
// · '🔥 이번 달 10일 연습 · 지금 7일 연속!' 14 SemiBold text-2)
// · 웹 Swagger 3.3 연습 달력(practiceDate) · 3.2 통계(currentStreak) — '이번 달 N일 연습'은 content 개수, '지금 N일 연속'은 3.2 currentStreak
// · 기획 메모 S09(18:1173: 날짜 클릭 → 그날의 S08 성장 리뷰 — 사용자 결정 2026-10-23으로 그날을 고른 연습 기록으로 바꿈) · 모션 메모 S09(18:3109: 연속 띠가 왼쪽 → 오른쪽으로 그려지고(scaleX 0→1)
// 날짜 동그라미가 차례로 채워짐, 오늘은 링 펄스, 월 이동 시 좌우 슬라이드)

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
/** 동그라미 · 띠가 차례로 채워지는 간격 */
const FILL_STAGGER = 0.03;

export function StreakCalendar({
  month,
  practicedDates,
  today,
  currentStreak,
}: {
  /** 보여 줄 달(YYYY-MM) */
  month: string;
  /** 그달 연습한 날(3.3 content의 practiceDate) */
  practicedDates: string[];
  today: string;
  currentStreak: number;
}) {
  const reduce = useReducedMotion();
  // 월 이동 방향(이전 달이면 왼쪽에서, 다음 달이면 오른쪽에서 들어온다). 직전에 보여 준 달과 비교한다.
  const [shown, setShown] = useState({ month, direction: 1 });
  if (shown.month !== month) setShown({ month, direction: month < shown.month ? -1 : 1 });
  const direction = shown.month === month ? shown.direction : month < shown.month ? -1 : 1;

  const weeks = buildCalendar(month, new Set(practicedDates), today);
  const label = monthLabel(month);

  return (
    <section
      aria-labelledby="streak-calendar-title"
      className="flex w-full shrink-0 flex-col gap-3 overflow-hidden rounded-3xl bg-bg-sub p-5 sm:p-6 lg:w-[560px]"
    >
      <div className="flex items-center gap-2">
        <h2
          id="streak-calendar-title"
          className="text-lg leading-normal font-extrabold tracking-[-0.2px] text-text-1"
        >
          스트릭 달력
        </h2>
        <span className="flex-1" />
        <MonthLink
          month={shiftMonth(month, -1)}
          label="이전 달"
          icon="/mypage/icon-chevron-left.svg"
        />
        <p className="text-[15px] leading-normal font-bold tracking-[-0.2px] whitespace-nowrap text-text-1">
          {label}
        </p>
        <MonthLink
          month={shiftMonth(month, 1)}
          label="다음 달"
          icon="/mypage/icon-chevron-right.svg"
        />
      </div>

      <div role="grid" aria-label={`${label} 연습 달력`} className="flex flex-col gap-3">
        <div role="row" className="flex">
          {WEEKDAYS.map((weekday) => (
            <span
              key={weekday}
              role="columnheader"
              className="flex flex-1 justify-center text-[13px] leading-normal font-semibold tracking-[-0.2px] text-text-3"
            >
              {weekday}
            </span>
          ))}
        </div>
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={month}
            custom={direction}
            className="flex flex-col gap-3"
            initial={reduce ? false : { x: direction * 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? undefined : { x: direction * -40, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {weeks.map((week, row) => (
              <div key={row} role="row" className="flex">
                {week.map((day, column) => (
                  <div key={column} role="gridcell" className="relative h-10 min-w-0 flex-1">
                    {day && <DayCell day={day} order={day.day} reduce={reduce} />}
                  </div>
                ))}
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="flex items-center gap-1.5 text-sm leading-normal font-semibold tracking-[-0.2px] text-text-2">
        <Image src="/mypage/icon-flame-sm.svg" alt="" width={14} height={14} />
        이번 달 {practicedDates.length}일 연습 · 지금 {currentStreak}일 연속!
      </p>
    </section>
  );
}

function MonthLink({ month, label, icon }: { month: string; label: string; icon: string }) {
  return (
    <Link
      href={mypagePath(month)}
      scroll={false}
      aria-label={label}
      className="flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <MaskIcon src={icon} size={18} className="bg-text-3" />
    </Link>
  );
}

function DayCell({
  day,
  order,
  reduce,
}: {
  day: CalendarDay;
  order: number;
  reduce: boolean | null;
}) {
  const delay = reduce ? 0 : order * FILL_STAGGER;
  const today = day.state === "today";
  const [, monthNumber] = day.date.split("-").map(Number);
  const name = `${monthNumber}월 ${day.day}일${day.practiced ? " 연습함" : ""}${today ? " 오늘" : ""}`;

  const circle = `absolute top-[3px] left-1/2 flex size-[34px] -translate-x-1/2 items-center justify-center rounded-full text-[13px] leading-normal tracking-[-0.2px]`;
  const content = (
    <>
      {day.practiced && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-brand-strong"
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay, type: "spring", stiffness: 500, damping: 30 }}
        />
      )}
      {today && !reduce && (
        <motion.span
          aria-hidden
          data-testid="today-pulse"
          className={`absolute rounded-full border-2 border-brand ${day.practiced ? "inset-0" : "-inset-0.5"}`}
          animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span className="relative">{day.day}</span>
    </>
  );

  const tone = day.practiced
    ? "font-extrabold text-white"
    : today
      ? "border-2 border-brand font-extrabold text-brand-ink"
      : day.state === "past"
        ? "font-medium text-text-2"
        : "font-medium text-text-3";

  return (
    <>
      {day.joinPrev && <Band side="left" delay={delay} reduce={reduce} />}
      {day.joinNext && <Band side="right" delay={delay} reduce={reduce} />}
      {day.state === "future" ? (
        <span className={`${circle} ${tone}`}>{content}</span>
      ) : (
        <Link
          href={recordsPath(day.date)}
          aria-label={name}
          className={`${circle} ${tone} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`}
        >
          {content}
        </Link>
      )}
    </>
  );
}

/** 연속한 날을 잇는 띠의 왼쪽 · 오른쪽 반쪽(동그라미 가운데에서 칸 끝까지) */
function Band({
  side,
  delay,
  reduce,
}: {
  side: "left" | "right";
  delay: number;
  reduce: boolean | null;
}) {
  return (
    <motion.span
      aria-hidden
      data-testid="streak-band"
      className={`absolute top-1 h-8 w-1/2 origin-left bg-band dark:bg-band/17 ${side === "left" ? "left-0" : "left-1/2"}`}
      initial={reduce ? false : { scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{
        delay: side === "left" ? Math.max(0, delay - FILL_STAGGER / 2) : delay,
        duration: 0.15,
        ease: "linear",
      }}
    />
  );
}
