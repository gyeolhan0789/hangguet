import { addDays, weekdayOf } from "@/lib/date";
import { tierOf, withAlpha, type StreakTier } from "@/lib/streak";
import type { CriterionReview, GrowthReviewResponse } from "@/types/api";

// S08 · S08-B · S08-C 표시 규칙.
// 기준: 웹 Swagger 7.1 · S08 '오늘 나아진 점'은 delta > 0인 기준, 자소서 검증(COVER_LETTER)은 delta 없이 comment만(grade가 GOOD이면
// '막힘 없이 통과'), S08-C는 delta 대신 grade로 기준점, 설문 유도(S08-B, 3 · 7 · 21일째)는 화면이 streakOnDate로 판단
// · GrowthReviewResponse.practiceDates(그날 포함 최근 7일 중 연습한 날) · Figma S08(18:2710) · S08-B(18:4578) · S08-C(18:4720)
// · 사용자 결정(2026-10-22: 자소서 검증은 '좋아요'일 때만 [통과]로 보여 주고 아니면 넣지 않는다, 지난 날짜는 '오늘' 문구를 그날 문구로)

/** '오늘 나아진 점'의 한 줄. 자소서 검증은 변화량 대신 '통과' */
export type ImprovedRow = { review: CriterionReview } & (
  { kind: "delta"; delta: number } | { kind: "pass" }
);

/** 나아진 점: 점수가 오른 기준(+N)과, '좋아요'인 자소서 검증(통과). 응답 순서를 따른다 */
export function improvedRows(criteria: CriterionReview[]): ImprovedRow[] {
  return criteria.flatMap((review): ImprovedRow[] => {
    if (review.criterion === "COVER_LETTER") {
      return review.grade === "GOOD" ? [{ review, kind: "pass" }] : [];
    }
    return review.delta !== null && review.delta > 0
      ? [{ review, kind: "delta", delta: review.delta }]
      : [];
  });
}

/** 7일 동그라미 한 칸 */
export interface ReviewDay {
  date: string;
  /** 아래 글자: 요일 · '오늘' · '+1'… */
  label: string;
  /** 연습한 날 */
  done: boolean;
  /** 그날(리뷰한 날) */
  current: boolean;
}

/**
 * 7일 동그라미. S08은 그날까지 최근 7일(요일, 마지막 칸은 오늘이면 '오늘'), S08-C(첫 연습일)는 그날부터 앞으로 7일
 * ('오늘'(지난 날이면 요일) · +1 … +6).
 */
export function reviewWeek(review: GrowthReviewResponse, isToday: boolean): ReviewDay[] {
  const practiced = new Set(review.practiceDates);
  const own = review.practiceDate;
  const ownLabel = isToday ? "오늘" : weekdayOf(own);
  if (review.isFirst) {
    return Array.from({ length: 7 }, (_, i) => ({
      date: addDays(own, i),
      label: i === 0 ? ownLabel : `+${i}`,
      done: i === 0,
      current: i === 0,
    }));
  }
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(own, i - 6);
    return {
      date,
      label: date === own ? ownLabel : weekdayOf(date),
      done: practiced.has(date),
      current: date === own,
    };
  });
}

/** YYYY-MM-DD → '10월 13일' */
export function monthDay(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}월 ${day}일`;
}

/**
 * 불꽃 단계 칩의 색. Figma에 그려진 단계(불씨 red · 활활 불꽃 brand · 황금 불꽃 gold 토큰)는 그 토큰을 쓰고,
 * 그림이 없는 단계(푸른 불꽃 · 전설의 불꽃)는 단계 색(lib/streak)을 옅게 깔고 글자를 단계 색으로 쓴다.
 */
export function tierChipTone(tier: StreakTier): {
  className?: string;
  style?: { backgroundColor: string; color: string };
} {
  if (tier.name === "불씨") return { className: "bg-red-soft text-red-ink dark:bg-red-soft/9" };
  if (tier.name === "활활 불꽃") {
    return { className: "bg-brand-soft text-brand-ink dark:bg-brand-soft/8" };
  }
  if (tier.name === "황금 불꽃") {
    return { className: "bg-gold-soft text-gold-ink dark:bg-gold-soft/9" };
  }
  return { style: { backgroundColor: withAlpha(tier.to, 0.12), color: tier.to } };
}

/** 불꽃 단계 칩 문구. '황금 불꽃 · 8일째' */
export function tierChipText(days: number): string {
  return `${tierOf(days).name} · ${days}일째`;
}

/** 설문을 띄우는 스트릭(기획 메모 S08-B: 3일째 · 7일째 · 21일 완주) */
export const SURVEY_STREAKS = [3, 7, 21] as const;

/** 그날 스트릭이 설문 회차면 그 회차, 아니면 null */
export function surveyRound(streakOnDate: number): number | null {
  return (SURVEY_STREAKS as readonly number[]).includes(streakOnDate) ? streakOnDate : null;
}
