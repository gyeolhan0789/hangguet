// 스트릭 뱃지 단계 (Figma "스트릭 뱃지 색상 — 확정"). 불 온도 순서: 회색 → 빨강 → 주황 → 금색 → 파랑 → 오로라.
// 홈 뱃지, S02-1 인트로, S02-L 레벨업이 같이 쓴다.

export interface StreakTier {
  min: number;
  max: number;
  name: string;
  /** 뱃지 세로 그라데이션 위·아래 색 */
  from: string;
  to: string;
  /** 오로라처럼 가운데 색이 더 있는 단계 */
  via?: string;
  /** S02-1 인트로에서 화면을 덮는 색 (전설의 불꽃은 흰 글씨가 읽히도록 한 톤 진한 그라데이션) */
  wipe: string;
  /** 인트로 위 글씨 색 */
  ink: string;
  /** "불꽃이 ○○으로 바뀌었어요" */
  colorWord: string;
}

export const STREAK_TIERS: readonly StreakTier[] = [
  {
    min: 0,
    max: 0,
    name: "스트릭 끊김",
    from: "#C9CFD6",
    to: "#8B95A1",
    wipe: "#8B95A1",
    ink: "#FFFFFF",
    colorWord: "회색",
  },
  {
    min: 1,
    max: 2,
    name: "불씨",
    from: "#FF7A45",
    to: "#F0441F",
    wipe: "#F0441F",
    ink: "#FFFFFF",
    colorWord: "빨간색",
  },
  {
    min: 3,
    max: 5,
    name: "활활 불꽃",
    from: "#FFA766",
    to: "#FF7A26",
    wipe: "#FF7A26",
    ink: "#FFFFFF",
    colorWord: "주황색",
  },
  {
    min: 6,
    max: 7,
    name: "황금 불꽃",
    from: "#FFD66B",
    to: "#F5A000",
    wipe: "#F5A000",
    ink: "#2B1A00",
    colorWord: "금색",
  },
  {
    min: 8,
    max: 13,
    name: "푸른 불꽃",
    from: "#7CC4FF",
    to: "#2F6BFF",
    wipe: "#2F6BFF",
    ink: "#FFFFFF",
    colorWord: "파란색",
  },
  {
    min: 14,
    max: Number.POSITIVE_INFINITY,
    name: "전설의 불꽃",
    from: "#C9B6FF",
    via: "#8FD3FF",
    to: "#FFB8E8",
    wipe: "linear-gradient(135deg,#8F78FF 0%,#5AA9FF 50%,#FF7AC6 100%)",
    ink: "#FFFFFF",
    colorWord: "오로라 빛",
  },
];

export function tierOf(days: number): StreakTier {
  const safe = Math.max(0, Math.floor(days));
  return STREAK_TIERS.find((tier) => safe >= tier.min && safe <= tier.max) ?? STREAK_TIERS[0];
}

export function nextTierOf(tier: StreakTier): StreakTier | null {
  const index = STREAK_TIERS.indexOf(tier);
  return STREAK_TIERS[index + 1] ?? null;
}

export function previousTierOf(tier: StreakTier): StreakTier {
  const index = STREAK_TIERS.indexOf(tier);
  return STREAK_TIERS[Math.max(0, index - 1)];
}

/** 뱃지 배경: 위에서 아래로 그라데이션 */
export function badgeGradient(tier: StreakTier): string {
  return `linear-gradient(180deg, ${[tier.from, tier.via, tier.to].filter(Boolean).join(", ")})`;
}

/** #RRGGBB에 투명도를 붙인다. 예: withAlpha("#F5A000", 0.4) → "#F5A00066" */
export function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}
