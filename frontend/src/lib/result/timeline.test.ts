// @vitest-environment node
// 기준: 웹 Swagger 6.4 ReplayItem.timeline(at · start · end는 영상 위치(초), value는 그 면접 평균이 0인 표준화 값)
// · 사용자 결정(2026-10-30 · 11-02: 5초씩 묶어 평균, 값이 없는 시간은 평균(0), 체크포인트를 누르면 이유별로 보여 준다)
import { describe, expect, it } from "vitest";

import { REPLAY } from "@/test/result-examples";
import type { ReplayItem, TimelineCheckpoint, TimelinePoint } from "@/types/api";

import { checkpointNear, clock, reasonLabel, timelineSeries, valueAt } from "./timeline";

// 예시 데이터: Swagger 6.4 예시의 4번 질문(체크포인트 623.25초) + 테스트용 작은 점 목록
const SAMPLE_CHECKPOINT = REPLAY.items[3].timeline!.checkpoints[0];

const checkpoint = (at: number, start = at, end = at): TimelineCheckpoint => ({
  at,
  start,
  end,
  value: -2,
  reasons: [],
});

const answer = (points: TimelinePoint[], checkpoints: TimelineCheckpoint[] = []): ReplayItem => ({
  ...REPLAY.items[0],
  timeline: { points, checkpoints },
});

const average = (time: number) => ({ time, value: 0, measured: false });
const measured = (time: number, value: number) => ({ time, value, measured: true });

describe("timelineSeries · 다시보기 곡선", () => {
  describe("정상 처리", () => {
    it("답변 안의 점을 첫 점부터 5초씩 묶어 시각과 값을 평균한 점으로 바꾼다", () => {
      const values = [0, 10, 0, 10, 0, 10, 0];
      const series = timelineSeries([answer(values.map((value, i) => ({ at: 10 + i, value })))]);

      // 10~14초 → 12초 · 평균 4, 15~16초(남은 점) → 15.5초 · 평균 5
      expect(series?.points.filter((point) => point.measured)).toEqual([
        measured(12, 4),
        measured(15.5, 5),
      ]);
    });

    it("영상 처음(0초)의 평균 점부터 첫 답변까지 잇는다", () => {
      const series = timelineSeries([answer([{ at: 30, value: 1 }])]);

      expect(series?.points).toEqual([average(0), average(10), average(20), measured(30, 1)]);
    });

    it("답변 사이 빈 시간은 양 끝에서 10초 떨어진 평균(0) 점으로 잇는다", () => {
      const series = timelineSeries([
        answer([{ at: 30, value: 1 }]),
        answer([{ at: 70, value: -1 }]),
      ]);

      expect(series?.points.slice(3)).toEqual([
        measured(30, 1),
        average(40),
        average(60),
        measured(70, -1),
      ]);
    });

    it("영상 길이가 마지막 답변보다 길면 영상 끝까지 평균 점으로 잇는다", () => {
      const series = timelineSeries([answer([{ at: 30, value: 1 }])], 80);

      expect(series?.points.slice(3)).toEqual([
        measured(30, 1),
        average(40),
        average(70),
        average(80),
      ]);
    });

    it("여러 답변의 체크포인트를 영상 위치 순으로 모은다", () => {
      const first = [checkpoint(14), checkpoint(11)];
      const second = [checkpoint(50)];
      const series = timelineSeries([
        answer([{ at: 10, value: -2 }], first),
        answer([{ at: 50, value: -2 }], second),
      ]);

      expect(series?.checkpoints).toEqual([first[1], first[0], second[0]]);
    });
  });

  describe("경계값", () => {
    it("빈 시간이 20초 이하이면 가운데에 평균 점 하나만 둔다", () => {
      const series = timelineSeries([
        answer([{ at: 30, value: 1 }]),
        answer([{ at: 45, value: -1 }]),
      ]);

      expect(series?.points.slice(3)).toEqual([measured(30, 1), average(37.5), measured(45, -1)]);
    });

    it("영상 길이를 아직 모르면(0) 마지막 답변 뒤를 잇지 않는다", () => {
      const series = timelineSeries([answer([{ at: 30, value: 1 }])], 0);

      expect(series?.points.at(-1)).toEqual(measured(30, 1));
    });

    it("첫 답변이 0초에 시작하면 영상 처음 점을 따로 넣지 않는다", () => {
      const series = timelineSeries([answer([{ at: 0, value: 1 }])]);

      expect(series?.points).toEqual([measured(0, 1)]);
    });
  });

  describe("오류 처리", () => {
    it.each([
      { label: "없음(null)", timeline: null },
      { label: "빈 점 목록", timeline: { points: [], checkpoints: [] } },
    ])("타임라인이 '$label'뿐이면 null을 돌려준다", ({ timeline }) => {
      expect(timelineSeries([{ ...REPLAY.items[0], timeline }])).toBeNull();
    });
  });
});

describe("valueAt · 체크포인트 점 높이", () => {
  describe("정상 처리", () => {
    it("평균으로 채운 점은 빼고 가장 가까운 측정 점의 값을 돌려준다", () => {
      const points = [measured(10, 1), average(11), measured(20, -2)];

      expect(valueAt(points, 12)).toBe(1);
    });
  });
});

describe("checkpointNear · 누른 곳의 체크포인트", () => {
  describe("정상 처리", () => {
    it("누른 위치가 낮은 구간 안이면 그 체크포인트를 고른다", () => {
      const wide = checkpoint(100, 90, 101);

      expect(checkpointNear([wide], 92)).toBe(wide);
    });
  });

  describe("경계값", () => {
    it("가장 낮은 지점에서 정확히 5초 떨어져 있으면 고른다", () => {
      expect(checkpointNear([SAMPLE_CHECKPOINT], 628.25)).toBe(SAMPLE_CHECKPOINT);
    });

    it("구간 밖이고 가장 낮은 지점에서 5초보다 멀면 null을 돌려준다", () => {
      expect(checkpointNear([SAMPLE_CHECKPOINT], 628.5)).toBeNull();
    });

    it("여럿이 가까우면 가장 낮은 지점이 가장 가까운 것을 고른다", () => {
      const near = [checkpoint(10), checkpoint(14)];

      expect(checkpointNear(near, 13)).toBe(near[1]);
    });

    it("거리가 같으면 앞의 체크포인트를 고른다", () => {
      const near = [checkpoint(10), checkpoint(14)];

      expect(checkpointNear(near, 12)).toBe(near[0]);
    });
  });
});

describe("reasonLabel · 체크포인트 이유 이름", () => {
  describe("정상 처리", () => {
    it("횟수가 없으면 지표 이름만 쓴다", () => {
      expect(reasonLabel(SAMPLE_CHECKPOINT.reasons[0])).toBe("자신감");
    });

    it("횟수가 있으면 '지표 이름 N회'로 쓴다", () => {
      expect(reasonLabel(SAMPLE_CHECKPOINT.reasons[1])).toBe("군말 3회");
    });
  });
});

describe("clock · 영상 위치 표시", () => {
  describe("정상 처리", () => {
    it("초를 초 두 자리의 '분:초'로 바꾼다", () => {
      expect(clock(5)).toBe("0:05");
      expect(clock(605)).toBe("10:05");
    });
  });

  describe("경계값", () => {
    it("소수 초는 버린다", () => {
      expect(clock(623.25)).toBe("10:23");
    });
  });
});
