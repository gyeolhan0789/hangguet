import Link from "next/link";
import type { ReactNode } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { shortDate } from "@/lib/date";
import { formatImprovement, formatReviewImprovement } from "@/lib/home/format";
import { growthReviewPath } from "@/lib/routes";
import type { HomeResponse, RecentReviewItem } from "@/types/api";

const card = "flex flex-col rounded-3xl bg-bg-sub";

function CardLabel({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <MaskIcon src={icon} size={16} className="bg-text-3" />
      <span className="text-[15px] leading-normal font-bold text-text-3">{children}</span>
    </span>
  );
}

/** 왼쪽 카드 공통 틀: 라벨 · 큰 문구 · 아래 줄 (링크면 아래 줄이 주황) */
function FeatureCard({
  icon,
  label,
  title,
  footer,
  href,
}: {
  icon: string;
  label: string;
  title: string;
  footer: string;
  href?: string;
}) {
  const body = (
    <>
      <CardLabel icon={icon}>{label}</CardLabel>
      <span className="text-[22px] leading-normal font-bold text-text-1">{title}</span>
      <span
        className={`text-[15px] leading-normal ${href ? "font-bold text-brand-ink" : "font-medium text-text-3"}`}
      >
        {footer}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={`${card} gap-2.5 p-7`}>
      {body}
    </Link>
  ) : (
    <div className={`${card} gap-2.5 p-7`}>{body}</div>
  );
}

/** S02 '어제의 나에게서' — 직전 성장 리뷰의 '다음에 해볼 것' */
export function NextActionCard({ home }: { home: HomeResponse }) {
  const [action] = home.nextActions;
  if (!action) return null;
  return (
    <FeatureCard
      icon="/home/icon-quote.svg"
      label="어제의 나에게서"
      title={`“${action}”`}
      footer={
        home.nextActionsDate
          ? `${shortDate(home.nextActionsDate)} 성장 리뷰의 ‘다음에 해볼 것’`
          : "지난 성장 리뷰의 ‘다음에 해볼 것’"
      }
    />
  );
}

/** S02-B '오늘 나아진 점' → 오늘 성장 리뷰(S08) */
export function TodayImprovedCard({ home, today }: { home: HomeResponse; today: string }) {
  if (home.todayImprovements.length === 0) return null;
  return (
    <FeatureCard
      icon="/home/icon-sparkles-sm.svg"
      label="오늘 나아진 점"
      title={home.todayImprovements.map(formatImprovement).join(" · ")}
      footer="오늘의 성장 리뷰 보기 →"
      href={growthReviewPath(today)}
    />
  );
}

/** S02-C '지난번 마지막 연습' → 그날 성장 리뷰(S08) */
export function LastPracticeCard({ home }: { home: HomeResponse }) {
  const [last] = home.recentReviews;
  if (!last) return null;
  // 첫 연습일이라 오른 점수가 없으면 회사명을 대신 보여 준다.
  const detail = formatReviewImprovement(last) ?? last.companyName;
  return (
    <FeatureCard
      icon="/home/icon-history.svg"
      label="지난번 마지막 연습"
      title={`${shortDate(last.practiceDate)} · ${detail}`}
      footer="그때 성장 리뷰 보기 →"
      href={growthReviewPath(last.practiceDate)}
    />
  );
}

function ReviewRow({ review }: { review: RecentReviewItem }) {
  // 첫 연습일이라 오른 점수가 없으면 점수 칩을 빼고 날짜 · 회사명만 보여 준다.
  const improvement = formatReviewImprovement(review);
  return (
    <Link
      href={growthReviewPath(review.practiceDate)}
      aria-label={[
        shortDate(review.practiceDate),
        review.companyName,
        improvement,
        "성장 리뷰 보기",
      ]
        .filter(Boolean)
        .join(" ")}
      className="flex items-center justify-between gap-3 py-2.5"
    >
      <span className="flex min-w-0 items-center gap-3 leading-normal font-semibold">
        <span className="text-[15px] text-text-3">{shortDate(review.practiceDate)}</span>
        <span className="truncate text-base text-text-1">{review.companyName}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {improvement && (
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[13px] leading-normal font-bold text-brand-ink dark:bg-brand-soft/8">
            {improvement}
          </span>
        )}
        <MaskIcon src="/home/icon-chevron-right.svg" size={18} className="bg-text-3" />
      </span>
    </Link>
  );
}

/** '최근 성장 리뷰' — 행을 누르면 그날 성장 리뷰(S08) */
export function RecentReviewsCard({ reviews }: { reviews: RecentReviewItem[] }) {
  if (reviews.length === 0) return null;
  return (
    <div className={`${card} gap-1 px-7 py-6`}>
      <span className="text-[15px] leading-normal font-bold text-text-3">최근 성장 리뷰</span>
      {reviews.map((review) => (
        <ReviewRow key={`${review.practiceDate}-${review.companyName}`} review={review} />
      ))}
    </div>
  );
}

/** S02-D 첫 방문: 비어 있는 최근 성장 리뷰 */
export function EmptyRecentReviews() {
  return (
    <div className="flex w-full max-w-[1120px] items-center gap-2.5 rounded-[20px] border border-line bg-bg-sub px-6 py-[18px]">
      <MaskIcon src="/home/icon-inbox.svg" size={18} className="bg-text-3" />
      <span className="text-[15px] leading-normal font-semibold text-text-3">
        최근 성장 리뷰 · 첫 면접을 마치면 여기에 차곡차곡 쌓여요
      </span>
    </div>
  );
}
