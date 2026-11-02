import type {
  ReplayItem,
  TimelineCheckpoint,
  TimelineMetric,
  TimelinePoint,
  TimelineReason,
} from "@/types/api";

// S07-1 다시보기 타임라인. 질문마다 내려온 타임라인을 하나의 곡선으로 잇고, 누른 지점의 체크포인트를 찾는다.
// 기준: 웹 Swagger 6.4 ReplayItem.timeline(at · start · end는 영상 위치(초), value는 그 면접 평균이 0인 표준화 값)
// · 사용자 결정(2026-10-30: 곡선은 인상 6항목 평균과 말끝 흐림 · 군말 · 긴 멈춤을 합친 값, 평균보다 유난히 낮은 지점에
//   체크포인트를 두고 누르면 무엇이 부족했는지 이유별로 보여 준다)

const METRIC_NAMES: Record<TimelineMetric, string> = {
  STABILITY: "안정감",
  CONFIDENCE: "자신감",
  EXPRESSION: "의사표현",
  EMOTION: "감정 전달",
  LIKEABILITY: "매력도",
  TRUST: "신뢰도",
  TRAILING_OFF: "말끝 흐림",
  FILLER: "군말",
  LONG_PAUSE: "긴 멈춤",
};

/** 누른 위치에서 이 범위(초) 안의 체크포인트를 고른다. 체크포인트 이유를 본 범위(앞뒤 5초)와 같다 */
const SELECT_RANGE_SECONDS = 5;

/**
 * 곡선 한 점. 곡선은 영상 처음부터 끝까지 실선 하나로 잇는다.
 * 값이 없는 시간(질문을 듣는 시간 등)은 평균(0)으로 보고, measured가 false다. 화면은 measured인 점만 위아래로 칠한다.
 */
export interface ChartPoint {
  time: number;
  value: number;
  measured: boolean;
}

interface TimelineSeries {
  points: ChartPoint[];
  checkpoints: TimelineCheckpoint[];
}

/**
 * 곡선을 그리는 평균 구간(초). 1초 값을 그대로 이으면 많이 출렁이고, 1초마다 앞뒤 평균을 내도 잔물결이 남아
 * 5초씩 묶어 한 점으로 그린다(사용자 결정 2026-10-30 · 11-02)
 */
const SMOOTH_SECONDS = 5;

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** 답변 하나의 점을 첫 점부터 5초씩 묶어 시각 · 값을 평균한 점. 마지막 묶음은 남은 점만 평균한다 */
function smooth(points: readonly TimelinePoint[]): ChartPoint[] {
  const groups = new Map<number, TimelinePoint[]>();
  for (const point of points) {
    const group = Math.floor((point.at - points[0].at) / SMOOTH_SECONDS);
    groups.set(group, [...(groups.get(group) ?? []), point]);
  }
  return [...groups.values()].map((group) => ({
    time: mean(group.map((point) => point.at)),
    value: mean(group.map((point) => point.value)),
    measured: true,
  }));
}

/** 곡선에서 time에 가장 가까운 실제 값(체크포인트 점을 곡선 위에 찍는다). 없으면 null */
export function valueAt(points: readonly ChartPoint[], time: number) {
  let nearest: ChartPoint | null = null;
  for (const point of points) {
    if (!point.measured) continue;
    if (!nearest || Math.abs(point.time - time) < Math.abs(nearest.time - time)) nearest = point;
  }
  return nearest?.value ?? null;
}

/** 값이 없는 시간에서 평균(0)으로 내려가고 올라오는 데 쓰는 시간(초). 곡선이 평균선으로 끊김 없이 이어진다 */
const GAP_RAMP_SECONDS = 10;

/** 값이 없는 시간(from ~ to)의 평균(0) 점. 양 끝에서 GAP_RAMP_SECONDS만큼 떨어뜨려 앞뒤 곡선에서 완만하게 이어진다 */
function gap(from: number, to: number): ChartPoint[] {
  if (to <= from) return [];
  const ramp = Math.min(GAP_RAMP_SECONDS, (to - from) / 2);
  const points = [{ time: from + ramp, value: 0, measured: false }];
  if (to - ramp > from + ramp) points.push({ time: to - ramp, value: 0, measured: false });
  return points;
}

/**
 * 질문 순 타임라인을 영상 처음(0초)부터 duration까지 실선 하나로 잇는다. 곡선은 답변 안에서만 5초씩 묶어 평균한다.
 * 첫 답변 전 · 답변 사이 · 마지막 답변 뒤는 값이 없어 평균(0)으로 둔다(사용자 결정 2026-11-02).
 * 계산(체크포인트)에는 넣지 않고 그릴 때만 채운다. 타임라인이 있는 답변이 없으면 null
 */
export function timelineSeries(items: readonly ReplayItem[], duration = 0): TimelineSeries | null {
  const timelines = items.flatMap((item) =>
    item.timeline && item.timeline.points.length > 0 ? [item.timeline] : [],
  );
  if (timelines.length === 0) return null;
  const points: ChartPoint[] = [];
  let end = 0;
  for (const timeline of timelines) {
    const answer = smooth(timeline.points);
    // 영상 처음은 평균(0)에서 시작한다
    if (points.length === 0 && answer[0].time > 0)
      points.push({ time: 0, value: 0, measured: false });
    points.push(...gap(end, answer[0].time), ...answer);
    end = answer[answer.length - 1].time;
  }
  if (duration > end)
    points.push(...gap(end, duration), { time: duration, value: 0, measured: false });
  return {
    points,
    checkpoints: timelines.flatMap((timeline) => timeline.checkpoints).sort((a, b) => a.at - b.at),
  };
}

/** 누른 위치가 낮은 구간 안이거나 가장 낮은 지점에서 SELECT_RANGE_SECONDS 안인 체크포인트. 여럿이면 가장 가까운 것 */
export function checkpointNear(checkpoints: readonly TimelineCheckpoint[], time: number) {
  const near = checkpoints.filter(
    (checkpoint) =>
      (time >= checkpoint.start && time <= checkpoint.end) ||
      Math.abs(time - checkpoint.at) <= SELECT_RANGE_SECONDS,
  );
  return near.sort((a, b) => Math.abs(time - a.at) - Math.abs(time - b.at))[0] ?? null;
}

/** 자신감 · 군말 3회 */
export function reasonLabel(reason: TimelineReason) {
  const name = METRIC_NAMES[reason.metric];
  return reason.count === null ? name : `${name} ${reason.count}회`;
}

/** 0:00 · 12:05 */
export function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
