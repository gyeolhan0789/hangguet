"use client";

import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Variants,
} from "motion/react";
import { useEffect, useId } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { improvedRows } from "@/lib/growth/review";
import { CRITERION_LABEL, GRADE_LABEL } from "@/lib/result/format";
import type { CriterionReview, Grade } from "@/types/api";

// 기준: Figma S08 Cards(18:2784: 폭 1120 · 간격 20 · 카드 p28 둥글기 24, 위쪽 정렬 대신 사용자 결정으로 두 카드 같은 높이)
// · Card 오늘 나아진 점(18:2785: bg-sub · 간격 14 · 라벨 sparkles 16 + 15 Bold text-3 · 줄 py6 양끝 정렬 · 항목명 18 ExtraBold
//   · 칩 brand-soft · brand-ink px12 py6 간격 6 아이콘 14 · 13 Bold(+N은 trending-up, 자소서 검증은 check '통과') · 설명 15 Medium text-2)
// · Card 다음에 해볼 것(18:2819: brand-soft · 간격 12 · 라벨 target 16 + 15 Bold brand-ink · 28 ExtraBold 행간 1.3 자간 -0.8
//   · bell 14 + '내일 홈에서 다시 알려드려요' 14 Medium text-3)
// · S08-C Card 오늘의 기준점(18:4777: 라벨 flag 16 · 줄 py4 · 항목명 17 ExtraBold · 값 15 ExtraBold — 좋아요 text-1 · 보통 text-2
//   · 아쉬워요 danger · calendar-clock 14 + '내일부터 나아진 점을 비교해 드려요' 13 SemiBold text-3)
// · 모션 메모 S08(18:2843: 나아진 점 줄 stagger 0.1s 등장, +8 · +4 칩 카운트업, '다음에 해볼 것' 카드는 살짝 기울었다 펴지며 등장
//   (rotate -2 → 0)) · 모션 메모 S08-C(18:4831: '오늘의 기준점' 4줄 stagger 0.08s, 하단 안내 문구 페이드인)
// · API 명세 7.1 · GrowthReviewResponse(criteria · nextActions)
// · 사용자 결정(2026-10-22: '다음에 해볼 것'은 nextActions를 큰 글씨로만 보여 주고 회색 점 목록은 뺀다, 지난 날짜는 '오늘' 대신 '이날')

const BASE_COLOR: Record<Grade, string> = {
  GOOD: "text-text-1",
  NORMAL: "text-text-2",
  WEAK: "text-danger",
};

const rows = (stagger: number): Variants => ({
  hidden: {},
  shown: { transition: { staggerChildren: stagger, delayChildren: 0.3 } },
});
const row: Variants = { hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0 } };

/** 카드 제목. 카드(section)가 이 id로 이름을 얻어 보조 기술에서 영역(region)으로 읽힌다 */
function CardLabel({
  id,
  icon,
  text,
  tone,
}: {
  id: string;
  icon: string;
  text: string;
  tone: string;
}) {
  return (
    <p
      id={id}
      className={`flex items-center gap-1.5 text-[15px] leading-normal font-bold tracking-[-0.2px] ${tone}`}
    >
      <MaskIcon src={icon} size={16} className="bg-current" />
      {text}
    </p>
  );
}

/** +N이 0부터 올라간다 */
function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const count = useMotionValue(reduce ? value : 0);
  const text = useTransform(count, (current) => `+${Math.round(current)}`);
  useEffect(() => {
    if (reduce) return;
    const controls = animate(count, value, { duration: 0.6, delay: 0.5, ease: "easeOut" });
    return () => controls.stop();
  }, [count, value, reduce]);
  return (
    <>
      <span className="sr-only">+{value}</span>
      <motion.span aria-hidden>{text}</motion.span>
    </>
  );
}

/** S08 '오늘 나아진 점' */
export function ImprovedCard({ criteria, today }: { criteria: CriterionReview[]; today: boolean }) {
  const reduce = useReducedMotion();
  const labelId = useId();
  return (
    <section aria-labelledby={labelId} className="flex flex-col gap-3.5 rounded-3xl bg-bg-sub p-7">
      <CardLabel
        id={labelId}
        icon="/home/icon-sparkles-sm.svg"
        text={today ? "오늘 나아진 점" : "이날 나아진 점"}
        tone="text-text-3"
      />
      <motion.ul
        className="flex flex-col gap-3.5"
        variants={rows(0.1)}
        initial={reduce ? false : "hidden"}
        animate="shown"
      >
        {improvedRows(criteria).map((item) => (
          <motion.li
            key={item.review.criterion}
            variants={row}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5 tracking-[-0.2px]"
          >
            <span className="flex items-center gap-2.5">
              <span className="text-lg leading-normal font-extrabold text-text-1">
                {CRITERION_LABEL[item.review.criterion]}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-[13px] leading-normal font-bold text-brand-ink dark:bg-brand-soft/8">
                <MaskIcon
                  src={
                    item.kind === "pass" ? "/review/icon-check.svg" : "/review/icon-trending-up.svg"
                  }
                  size={14}
                  className="bg-current"
                />
                {item.kind === "pass" ? "통과" : <CountUp value={item.delta} />}
              </span>
            </span>
            {item.review.comment && (
              <span className="text-[15px] leading-normal font-medium break-keep text-text-2">
                {item.review.comment}
              </span>
            )}
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}

/** S08-C '오늘의 기준점': 첫 연습일이라 비교 대신 기준 4개의 등급을 보여 준다 */
export function BaselineCard({ criteria, today }: { criteria: CriterionReview[]; today: boolean }) {
  const reduce = useReducedMotion();
  const labelId = useId();
  return (
    <section aria-labelledby={labelId} className="flex flex-col gap-3.5 rounded-3xl bg-bg-sub p-7">
      <CardLabel
        id={labelId}
        icon="/review/icon-flag.svg"
        text={today ? "오늘의 기준점" : "이날의 기준점"}
        tone="text-text-3"
      />
      <motion.ul
        className="flex flex-col gap-3.5"
        variants={rows(0.08)}
        initial={reduce ? false : "hidden"}
        animate="shown"
      >
        {criteria.map((review) => (
          <motion.li
            key={review.criterion}
            variants={row}
            className="flex items-center justify-between py-1 leading-normal font-extrabold tracking-[-0.2px]"
          >
            <span className="text-[17px] text-text-1">{CRITERION_LABEL[review.criterion]}</span>
            <span className={`text-[15px] ${BASE_COLOR[review.grade]}`}>
              {GRADE_LABEL[review.grade]}
            </span>
          </motion.li>
        ))}
      </motion.ul>
      <motion.p
        className="flex items-center gap-1.5 text-[13px] leading-normal font-semibold tracking-[-0.2px] text-text-3"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.3 + criteria.length * 0.08 }}
      >
        <MaskIcon src="/review/icon-calendar-clock.svg" size={14} className="bg-current" />
        {today ? "내일부터 나아진 점을 비교해 드려요" : "다음 연습부터 나아진 점을 비교했어요"}
      </motion.p>
    </section>
  );
}

/** '다음에 해볼 것'. 오늘이면 내일 홈에서 다시 알려 준다는 안내를 붙인다 */
export function NextActionCard({ actions, today }: { actions: string[]; today: boolean }) {
  const reduce = useReducedMotion();
  const labelId = useId();
  return (
    <motion.section
      aria-labelledby={labelId}
      className="flex origin-bottom-left flex-col gap-3 rounded-3xl bg-brand-soft p-7 dark:bg-brand-soft/8"
      initial={reduce ? false : { rotate: -2, opacity: 0 }}
      animate={{ rotate: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.4 }}
    >
      <CardLabel
        id={labelId}
        icon="/review/icon-target.svg"
        text="다음에 해볼 것"
        tone="text-brand-ink"
      />
      {actions.map((action) => (
        <p
          key={action}
          className="text-[28px] leading-[1.3] font-extrabold tracking-[-0.8px] break-keep text-text-1"
        >
          {action}
        </p>
      ))}
      {today && (
        <p className="flex items-center gap-1.5 text-sm leading-normal font-medium tracking-[-0.2px] text-text-3">
          <MaskIcon src="/review/icon-bell.svg" size={14} className="bg-current" />
          내일 홈에서 다시 알려드려요
        </p>
      )}
    </motion.section>
  );
}
