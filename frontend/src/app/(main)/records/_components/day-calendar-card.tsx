"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { dateInMonth, monthDayLabel } from "@/lib/records/format";
import { growthReviewPath, recordsPath } from "@/lib/routes";
import {
  buildCalendar,
  monthDirection,
  monthLabel,
  monthOf,
  shiftMonth,
  weekCells,
  type CalendarDay,
} from "@/lib/user/calendar";

// 기준: Figma 연습 기록 초안 Day · Calendar Card(232:843: 폭 360 · bg-sub · 둥글기 24 · 패딩 28 · 간격 20 · 비활성 ‹ › text-3
// · '10월 21일' 22 ExtraBold · '면접 2회' 15 SemiBold text-3 · [이날 성장 리뷰 보기 ›] 높이 48 surface 둥글기 12 · 14 Bold
// · 구분선 line · '연습 달력' 18 ExtraBold · ‹ 2026년 10월 › 15 Bold · 요일 14 SemiBold brand · 날짜 15 Medium(지난날 text-2 · 앞날 text-3)
// · 연습한 날은 굵게 + 스트릭 띠(band, 높이 34 · 숫자 가운데에서 ±16 · 끝 둥글게) · 오늘은 brand 2px 테두리 원 36 · brand-ink)
// · 웹 Swagger 5.15(날짜별 연습 면접 수, 한국 시간 면접 시작 날짜 기준) · 5.13 page.totalElements(선택 날짜 면접 수)
// · 웹 Swagger 7.1(성장 리뷰 경로 값은 면접 시작 날짜)
// · 모션 메모 연습 기록(달력 달 넘기기는 쫀득한(스프링) 애니메이션)
// · 사용자 결정(2026-10-23: 고른 날이 오늘이 아니면 brand-ink 굵은 글씨, 성장 리뷰 버튼은 늘 보임)

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
/** 달 넘기기 스프링(모션 메모: 쫀득하게) */
const MONTH_SPRING = { type: "spring", stiffness: 380, damping: 24, mass: 0.9 } as const;
/** 달 넘기기. 나가는 달도 지금 넘기는 방향(custom)을 따라야 해서 variant 함수로 둔다 */
const MONTH_SLIDE = {
  enter: (direction: number) => ({ x: direction * 64, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction * -64, opacity: 0 }),
};

export function DayCalendarCard({
  date,
  today,
  interviewCount,
  practicedDates,
}: Readonly<{
  /** 고른 날(YYYY-MM-DD, 면접 시작일) */
  date: string;
  today: string;
  /** 고른 날의 면접 수(5.13 page.totalElements) */
  interviewCount: number;
  /** 고른 날이 든 달의 연습한 날(5.15 content 중 interviewCount가 1 이상인 practiceDate) */
  practicedDates: string[];
}>) {
  const reduce = useReducedMotion();
  const month = monthOf(date);
  // 넘기는 방향(이전 달이면 왼쪽에서, 다음 달이면 오른쪽에서 들어온다). 직전에 보여 준 달과 비교한다.
  const [shown, setShown] = useState({ month, direction: 1 });
  if (shown.month !== month) setShown({ month, direction: monthDirection(shown.month, month) });
  const direction = shown.month === month ? shown.direction : monthDirection(shown.month, month);

  const weeks = buildCalendar(month, new Set(practicedDates), today);
  const label = monthLabel(month);
  const prev = dateInMonth(shiftMonth(month, -1), date, today);
  const next = dateInMonth(shiftMonth(month, 1), date, today);

  return (
    <section
      aria-label="날짜 선택"
      className="flex w-full shrink-0 flex-col gap-5 overflow-hidden rounded-3xl bg-bg-sub p-6 sm:p-7 lg:min-h-[672px] lg:w-[360px]"
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[22px] leading-[1.3] font-extrabold tracking-[-0.6px] text-text-1">
            {monthDayLabel(date)}
          </h2>
          <p className="text-[15px] leading-normal font-semibold tracking-[-0.2px] text-text-3">
            면접 {interviewCount}회
          </p>
        </div>
        <Link
          href={growthReviewPath(date)}
          className="flex h-12 items-center justify-center gap-1 rounded-xl bg-surface text-sm leading-normal font-bold tracking-[-0.2px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          이날 성장 리뷰 보기
          <MaskIcon src="/mypage/icon-chevron-right.svg" size={16} className="bg-text-2" />
        </Link>
      </div>

      <span aria-hidden className="h-px w-full bg-line" />

      <div className="flex flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg leading-normal font-extrabold tracking-[-0.2px] text-text-1">
            연습 달력
          </h2>
          <span className="flex-1" />
          <MonthLink date={prev} label="이전 달" icon="/mypage/icon-chevron-left.svg" />
          <p className="text-[15px] leading-normal font-bold tracking-[-0.2px] whitespace-nowrap text-text-1">
            {label}
          </p>
          <MonthLink date={next} label="다음 달" icon="/mypage/icon-chevron-right.svg" />
        </div>

        <div role="grid" aria-label={`${label} 연습 달력`} className="flex flex-1 flex-col gap-3">
          <div role="row" className="flex">
            {WEEKDAYS.map((weekday) => (
              <span
                key={weekday}
                role="columnheader"
                className="flex flex-1 justify-center text-sm leading-normal font-semibold tracking-[-0.2px] text-brand"
              >
                {weekday}
              </span>
            ))}
          </div>
          <div className="relative flex flex-1 flex-col">
            <AnimatePresence mode="popLayout" initial={false} custom={direction}>
              <motion.div
                key={month}
                custom={direction}
                className="flex flex-1 flex-col justify-between gap-2"
                variants={MONTH_SLIDE}
                initial={reduce ? false : "enter"}
                animate="center"
                exit={reduce ? undefined : "exit"}
                transition={MONTH_SPRING}
              >
                {weeks.map((week) => {
                  const cells = weekCells(week);
                  return (
                    <div key={cells[0].date} role="row" className="flex">
                      {cells.map(({ date: cellDate, day }) => (
                        <div
                          key={cellDate}
                          role="gridcell"
                          className="relative h-[52px] min-w-0 flex-1"
                        >
                          {day && <DayCell day={day} selected={day.date === date} />}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

function MonthLink({
  date,
  label,
  icon,
}: Readonly<{ date: string | null; label: string; icon: string }>) {
  if (!date) {
    return (
      <span aria-hidden className="flex">
        <MaskIcon src={icon} size={18} className="bg-text-3" />
      </span>
    );
  }
  return (
    <Link
      href={recordsPath(date)}
      scroll={false}
      aria-label={label}
      className="flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <MaskIcon src={icon} size={18} className="bg-text-2" />
    </Link>
  );
}

/** 날짜 글자 모양: 오늘(테두리 원) → 고른 날 → 연습한 날 → 지난날 → 앞날 순으로 고른다 */
function dayTone(day: CalendarDay, selected: boolean): string {
  if (day.state === "today")
    return "size-9 border-2 border-brand bg-bg-sub font-extrabold text-brand-ink";
  if (selected) return "font-extrabold text-brand-ink";
  if (day.practiced) return "font-extrabold text-text-1";
  return day.state === "past" ? "font-medium text-text-2" : "font-medium text-text-3";
}

function DayCell({ day, selected }: Readonly<{ day: CalendarDay; selected: boolean }>) {
  const today = day.state === "today";
  const [, monthNumber] = day.date.split("-").map(Number);
  const name = `${monthNumber}월 ${day.day}일${day.practiced ? " 연습함" : ""}${today ? " 오늘" : ""}`;

  // 오늘은 테두리 원 36, 나머지는 34(누르는 자리)
  const className = `absolute top-1/2 left-1/2 flex ${today ? "" : "size-[34px]"} -translate-1/2 items-center justify-center rounded-full text-[15px] leading-normal tracking-[-0.2px] ${dayTone(day, selected)}`;

  return (
    <>
      {day.practiced && <Band day={day} />}
      {day.state === "future" ? (
        <span className={className}>{day.day}</span>
      ) : (
        <Link
          href={recordsPath(day.date)}
          scroll={false}
          aria-label={name}
          aria-current={selected ? "date" : undefined}
          className={`${className} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`}
        >
          {day.day}
        </Link>
      )}
    </>
  );
}

/** 연습한 날의 스트릭 띠. 이어진 쪽은 칸 끝까지, 끊긴 쪽은 숫자 둘레에서 둥글게 끝난다(주가 바뀌면 끊김). */
function Band({ day }: Readonly<{ day: CalendarDay }>) {
  return (
    <span
      aria-hidden
      data-testid="streak-band"
      className={`absolute top-1/2 h-[34px] -translate-y-1/2 bg-band dark:bg-band/17 ${
        day.joinPrev ? "left-0" : "left-[calc(50%-16px)] rounded-l-full"
      } ${day.joinNext ? "right-0" : "right-[calc(50%-16px)] rounded-r-full"}`}
    />
  );
}
