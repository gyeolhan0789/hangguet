"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Toast } from "@/components/toast";
import { StreakCelebration } from "@/components/streak/streak-celebration";
import { monthDay, reviewWeek, surveyRound } from "@/lib/growth/review";
import { useInterviewStore } from "@/stores/interview-store";
import type { GrowthReviewResponse } from "@/types/api";

import { Celebrate } from "./celebrate";
import { BaselineCard, ImprovedCard, NextActionCard } from "./review-cards";
import { ReviewDecision } from "./review-decision";
import { ReviewWeek } from "./review-week";
import { SurveyModal } from "./survey-modal";

// 기준: Figma S08 오늘의 성장 리뷰(18:2710: Body 위 32 · 간격 26 · 가운데 — 축하 → 7일 → 카드 2장(1120) → 한 번 더 할까요?)
// · S08-C 첫 면접(18:4720) · S08-B 설문 유도(18:4578) · 기획 메모 S08(18:767: 스트릭 달성 축하 → 나아진 점 → 다음에 해볼 것)
// · 기획 메모 S08-C(18:3736: 첫 면접이라 '나아진 점' 대신 '오늘의 기준점', 이번 주 대신 '오늘 · +1 … +6')
// · 웹 Swagger 7.1(isFirst → S08-C, streakOnDate로 설문 판단) · 5.8(leveledUp은 5.8 응답에만 있어 화면이 결과 화면까지 기억)
// · components/streak/streak-celebration('N일째 달성!'과 레벨업은 면접을 마친 화면(S08 흐름)이 한 번만 띄운다)
// · 사용자 결정(2026-10-22: S07에서 들어왔고 그날 첫 면접이면(스트릭이 오른 날) 'N일째 달성!'을 한 번 띄운다,
//   지난 날짜는 '오늘' 문구를 그날 문구로, 설문은 오늘 리뷰에서만)

/** S08 · S08-B · S08-C 성장 리뷰 화면 */
export function ReviewView({
  review,
  today,
  fromResult,
  surveyUrl,
  userId,
}: {
  review: GrowthReviewResponse;
  /** 리뷰한 날이 한국 시간 오늘인지 */
  today: boolean;
  /** S07 [오늘의 성장 리뷰 보기]로 막 들어왔는지 */
  fromResult: boolean;
  /** 설문 구글폼 주소. 없으면 설문을 띄우지 않는다 */
  surveyUrl: string | null;
  userId: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const leveledUp = useInterviewStore((state) => state.leveledUp);
  const setLeveledUp = useInterviewStore((state) => state.setLeveledUp);
  // 면접을 마치고 그날 첫 면접이면 스트릭이 오른 순간이라 축하를 먼저 띄운다(자정을 넘겨 열어도 막 끝낸 면접이다).
  const [celebrating, setCelebrating] = useState(fromResult && review.interviewCount === 1);
  const first = review.isFirst;
  const round = today ? surveyRound(review.streakOnDate) : null;
  const sub = first
    ? `첫 면접을 마쳤어요 · ${today ? "오늘" : "이날"}이 나의 기준점이에요`
    : `${monthDay(review.practiceDate)} · ${today ? "오늘 " : ""}면접 ${review.interviewCount}회 · ${review.practiceMinutes}분`;

  function finishCelebration() {
    setCelebrating(false);
    setLeveledUp(null);
    // 새로고침해도 축하를 다시 띄우지 않게 들어온 표시를 지운다.
    router.replace(pathname, { scroll: false });
  }

  if (celebrating) {
    return (
      <StreakCelebration
        days={review.streakOnDate}
        leveledUp={leveledUp ?? false}
        onDone={finishCelebration}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1152px] flex-col items-center gap-[26px] px-4 pt-8 pb-12">
      <Celebrate days={review.streakOnDate} first={first} sub={sub} />
      <ReviewWeek
        days={reviewWeek(review, today)}
        streak={review.streakOnDate}
        first={first}
        today={today}
      />
      {/* 두 카드는 같은 높이로 맞춘다('다음에 해볼 것'은 글이 짧아도 옆 카드만큼 크다. 사용자 결정 2026-10-22). */}
      <div className="grid w-full max-w-[1120px] gap-5 lg:grid-cols-2">
        {first ? (
          <BaselineCard criteria={review.criteria} today={today} />
        ) : (
          <ImprovedCard criteria={review.criteria} today={today} />
        )}
        <NextActionCard actions={review.nextActions} today={today} />
      </div>
      <ReviewDecision today={today} />
      {round !== null && surveyUrl && userId !== null && (
        <SurveyModal round={round} surveyUrl={surveyUrl} userId={userId} />
      )}
      <Toast />
    </div>
  );
}
