// 기준: 웹 Swagger 6.4 ReplayItem.timeline(4번 질문 체크포인트 623.25초: 자신감 · 군말 3회)
// · 사용자 결정(2026-10-30: 그래프를 누르면 영상이 그 위치로 가고, 누른 곳 가까이에 체크포인트가 있으면 보완할 점을 이유별로 보여 준다)
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { timelineSeries } from "@/lib/result/timeline";
import { REPLAY } from "@/test/result-examples";

import { ReplayTimeline } from "./replay-timeline";

// 경계 mock: 레이아웃이 없는 jsdom이라 그래프 상자의 위치 · 크기를 테스트가 정한다(좌우 여백 8px, 1px = 1초).
// recharts는 실제로 돈다(ResizeObserver가 없으면 그리기를 건너뛴다).

// 예시 데이터: Swagger 6.4 예시(영상 길이 1080초로 둠)
const DURATION = 1080;
const SERIES = timelineSeries(REPLAY.items, DURATION)!;
const OFFSETS = [38.88, 186.88, 368.88, 601.88, 866.88];
const HINT = "그래프의 빨간 점을 누르면 그 지점에서 보완할 점이 나와요.";

function renderTimeline(checkpoints = SERIES.checkpoints) {
  const onSeek = vi.fn();
  render(
    <ReplayTimeline
      points={SERIES.points}
      checkpoints={checkpoints}
      duration={DURATION}
      offsets={OFFSETS}
      time={0}
      onSeek={onSeek}
    />,
  );
  const chart = screen.getByTestId("replay-timeline-chart");
  vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width: DURATION + 16,
  } as DOMRect);
  return { chart, onSeek };
}

describe("ReplayTimeline · 다시보기 답변 흐름", () => {
  describe("화면 표시", () => {
    it("체크포인트가 없으면 아쉬웠던 지점이 없다는 안내를 보여 준다", () => {
      renderTimeline([]);

      expect(
        screen.getByText("이번 면접에서는 평소보다 유난히 아쉬웠던 지점이 없어요."),
      ).toBeDefined();
    });
  });

  describe("사용자 조작", () => {
    it("그래프를 누르면 좌우 여백을 뺀 비율로 영상 위치를 정해 옮긴다", () => {
      const { chart, onSeek } = renderTimeline();

      fireEvent.click(chart, { clientX: 8 + 100 });

      expect(onSeek).toHaveBeenCalledWith(100);
    });

    it("체크포인트 가까이를 누르면 그 지점의 보완할 점을 이유별로 보여 준다", () => {
      const { chart } = renderTimeline();

      fireEvent.click(chart, { clientX: 8 + 625 });

      expect(screen.getByText("10:23 보완할 점")).toBeDefined();
      expect(screen.getByText("자신감")).toBeDefined();
      expect(
        screen.getByText("고개가 숙여졌어요. 화면 속 면접관을 보며 말해 보세요."),
      ).toBeDefined();
      expect(screen.getByText("군말 3회")).toBeDefined();
      expect(
        screen.getByText("'음'이 이어졌어요. 생각할 때는 소리 없이 잠깐 멈춰도 괜찮아요."),
      ).toBeDefined();
    });

    it("체크포인트에서 먼 곳을 누르면 보완할 점을 닫고 안내로 돌아간다", () => {
      const { chart } = renderTimeline();
      fireEvent.click(chart, { clientX: 8 + 623 });

      fireEvent.click(chart, { clientX: 8 + 100 });

      expect(screen.queryByText("10:23 보완할 점")).toBeNull();
      expect(screen.getByText(HINT)).toBeDefined();
    });
  });

  describe("경계값", () => {
    it("그래프 왼쪽 여백을 누르면 영상 처음으로 옮긴다", () => {
      const { chart, onSeek } = renderTimeline();

      fireEvent.click(chart, { clientX: 3 });

      expect(onSeek).toHaveBeenCalledWith(0);
    });

    it("그래프 오른쪽 여백을 누르면 영상 끝으로 옮긴다", () => {
      const { chart, onSeek } = renderTimeline();

      fireEvent.click(chart, { clientX: 8 + DURATION + 5 });

      expect(onSeek).toHaveBeenCalledWith(DURATION);
    });
  });
});
