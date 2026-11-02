import { describe, expect, it } from "vitest";

import type { ReplayItem, TimelineCheckpoint } from "@/types/api";

import { checkpointNear, clock, reasonLabel, timelineSeries, valueAt } from "./timeline";

// 기준: 웹 Swagger 6.4 items[].timeline(at · start · end는 영상 위치(초)) · 사용자 결정(2026-10-30: 체크포인트를 누르면 이유별로 보여 준다)

const checkpoint = (at: number, start = at, end = at): TimelineCheckpoint => ({
  at,
  start,
  end,
  value: -2,
  reasons: [],
});

const item = (timeline: ReplayItem["timeline"]): ReplayItem => ({
  questionId: 1,
  seq: 1,
  question: "질문",
  questionCreatedAt: "2026-10-15T12:00:00+09:00",
  answer: "답",
  answerCreatedAt: "2026-10-15T12:01:00+09:00",
  grade: "GOOD",
  timeline,
});

describe("timelineSeries", () => {
  it("영상 처음부터 끝까지 한 줄로 잇고, 값이 없는 시간은 평균(0)으로 둔다", () => {
    const series = timelineSeries(
      [
        item({
          points: [
            { at: 10, value: 1 },
            { at: 11, value: -1 },
          ],
          checkpoints: [checkpoint(11)],
        }),
        item(null),
        item({ points: [{ at: 50, value: 0.5 }], checkpoints: [checkpoint(50)] }),
      ],
      60,
    );

    expect(series?.points).toEqual([
      // 첫 답변 전: 영상 처음(평균)에서 첫 값으로(10초 안이라 가운데 한 점)
      { time: 0, value: 0, measured: false },
      { time: 5.25, value: 0, measured: false },
      { time: 10.5, value: 0, measured: true },
      // 답변 사이: 끝값에서 10초 동안 평균으로 갔다가 다음 답변 첫 값으로
      { time: 20.5, value: 0, measured: false },
      { time: 40, value: 0, measured: false },
      { time: 50, value: 0.5, measured: true },
      // 마지막 답변 뒤: 영상 끝까지 평균
      { time: 55, value: 0, measured: false },
      { time: 60, value: 0, measured: false },
    ]);
    expect(series?.checkpoints.map((c) => c.at)).toEqual([11, 50]);
  });

  it("곡선은 답변 안에서만 5초씩 묶어 시각과 값을 평균한 점으로 그린다", () => {
    const values = [0, 10, 0, 10, 0, 10, 0];
    const series = timelineSeries([
      item({ points: values.map((value, at) => ({ at, value })), checkpoints: [] }),
      item({ points: [{ at: 100, value: 7 }], checkpoints: [] }),
    ]);

    // 0~4초 → 2초 · 평균 4, 5~6초(남은 점) → 5.5초 · 평균 5. 다음 답변 값은 앞 답변과 섞지 않는다
    expect(series?.points.filter((point) => point.measured)).toEqual([
      { time: 2, value: 4, measured: true },
      { time: 5.5, value: 5, measured: true },
      { time: 100, value: 7, measured: true },
    ]);
  });

  it("타임라인이 있는 답변이 없으면 null", () => {
    expect(timelineSeries([item(null), item({ points: [], checkpoints: [] })])).toBeNull();
  });
});

describe("checkpointNear", () => {
  const checkpoints = [checkpoint(100, 98, 101), checkpoint(200)];

  it("낮은 구간 안이거나 가장 낮은 지점에서 5초 안이면 고른다", () => {
    expect(checkpointNear(checkpoints, 98)?.at).toBe(100);
    expect(checkpointNear(checkpoints, 195)?.at).toBe(200);
    expect(checkpointNear(checkpoints, 205)?.at).toBe(200);
  });

  it("5초보다 멀면 고르지 않는다", () => {
    expect(checkpointNear(checkpoints, 150)).toBeNull();
    expect(checkpointNear(checkpoints, 205.5)).toBeNull();
  });

  it("여럿이면 가장 낮은 지점이 가장 가까운 것을 고른다", () => {
    expect(checkpointNear([checkpoint(10), checkpoint(14)], 13)?.at).toBe(14);
  });
});

describe("valueAt", () => {
  it("값이 없는(평균으로 채운) 점을 빼고 가장 가까운 점의 값", () => {
    const points = [
      { time: 10, value: 1, measured: true },
      { time: 11, value: 0, measured: false },
      { time: 20, value: -2, measured: true },
    ];

    expect(valueAt(points, 12)).toBe(1);
    expect(valueAt(points, 18)).toBe(-2);
    expect(valueAt([], 0)).toBeNull();
  });
});

describe("reasonLabel · clock", () => {
  it("인상 이유는 이름만, 음성 이유는 횟수를 붙인다", () => {
    expect(reasonLabel({ metric: "CONFIDENCE", count: null, text: "" })).toBe("자신감");
    expect(reasonLabel({ metric: "FILLER", count: 3, text: "" })).toBe("군말 3회");
  });

  it("영상 위치를 분:초로 쓴다", () => {
    expect(clock(623.25)).toBe("10:23");
    expect(clock(5)).toBe("0:05");
  });
});
