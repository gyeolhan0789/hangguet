// 기준: Figma S07-1 Video(18:4508) · Player Bar(18:4514: 지난 · 지금 · 앞 질문 마커, '06:12 / 18:00', 배속 칩) · Transcript(18:4530)
// · 자막은 재생 위치가 속한 질문의 answer · Next.js 16 Preserving UI State(숨겨지면 <video>를 직접 멈춘다)
// · 사용자 결정(2026-11-05: 받는 중이라 재생이 멈췄으면(버퍼링) 영상 가운데에 로딩을 보인다)
// · 사용자 결정(2026-10-28: 답하지 않은 질문 구간의 자막은 '답변하지 않은 질문이에요')
import { fireEvent, render, screen } from "@testing-library/react";
import { Activity, createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { REPLAY } from "@/test/result-examples";
import type { ReplayItem } from "@/types/api";

import { PlayerControls, VideoScreen, type PlayerState } from "./video-player";

// 경계 mock: 연출(motion)은 건너뛴다. <video>의 영상 정보(readyState · duration)와 pause는 jsdom에 없어 테스트가 정한다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 6.4 200 예시(마커 00:38 · 03:06 · 06:08 · 10:01 · 14:26, 영상 길이 18분으로 둠)
const ITEMS: ReplayItem[] = REPLAY.items;
const OFFSETS = [38.88, 186.88, 368.88, 601.88, 866.88];
const LOADING = { name: "영상을 불러오는 중" };

function screenView(item: ReplayItem | null = null) {
  const onDuration = vi.fn();
  const video = createRef<HTMLVideoElement>();
  const view = (
    <VideoScreen
      videoUrl={REPLAY.videoUrl}
      video={video}
      item={item}
      onTime={vi.fn()}
      onDuration={onDuration}
      onPlaying={vi.fn()}
      onRate={vi.fn()}
    />
  );
  return { view, onDuration };
}

function renderScreen(item: ReplayItem | null = null) {
  const { view, onDuration } = screenView(item);
  render(view);
  return { onDuration, element: screen.getByLabelText("녹화 영상") };
}

function renderControls(
  state: Partial<PlayerState> = {},
  { current = -1, items = ITEMS }: { current?: number; items?: ReplayItem[] } = {},
) {
  const onSeek = vi.fn();
  const result = render(
    <PlayerControls
      state={{ time: 0, duration: 1080, playing: false, rate: 1, ...state }}
      items={items}
      offsets={OFFSETS}
      current={current}
      onSeek={onSeek}
      onTogglePlay={vi.fn()}
      onNextRate={vi.fn()}
    />,
  );
  const markers = () =>
    Array.from(result.container.querySelectorAll<HTMLElement>("[data-marker]")).map(
      (marker) => marker.dataset.marker,
    );
  return { ...result, onSeek, markers };
}

describe("VideoScreen · 녹화 영상", () => {
  describe("화면 표시", () => {
    it("첫 질문 전이면 영상 위 질문을 보이지 않는다", () => {
      renderScreen(null);

      expect(screen.queryByText(/^Q\d$/)).toBeNull();
    });
  });

  describe("상태 변화", () => {
    it("재생 중에 데이터를 기다리면(waiting) 불러오는 중 표시를 보인다", () => {
      const { element } = renderScreen();

      fireEvent.waiting(element);

      expect(screen.getByRole("status", LOADING)).toBeDefined();
    });

    it.each([
      { event: "playing", fire: fireEvent.playing },
      { event: "pause", fire: fireEvent.pause },
      { event: "canplay", fire: fireEvent.canPlay },
      { event: "seeked", fire: fireEvent.seeked },
    ])("기다리는 중에 '$event'가 오면 불러오는 중 표시를 없앤다", ({ fire }) => {
      const { element } = renderScreen();
      fireEvent.waiting(element);

      fire(element);

      expect(screen.queryByRole("status", LOADING)).toBeNull();
    });
  });

  describe("경계값", () => {
    it("화면을 그리기 전에 영상 정보를 이미 받았으면 처음에 길이를 읽어 알린다", () => {
      vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(
        HTMLMediaElement.HAVE_METADATA,
      );
      vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(1080);

      const { onDuration } = renderScreen();

      expect(onDuration).toHaveBeenCalledWith(1080);
    });

    it("영상 정보를 아직 받지 않았으면 처음에 길이를 알리지 않는다", () => {
      vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(
        HTMLMediaElement.HAVE_NOTHING,
      );

      const { onDuration } = renderScreen();

      expect(onDuration).not.toHaveBeenCalled();
    });
  });

  describe("정리", () => {
    it("다른 화면으로 가 숨겨지면 영상을 멈춘다", () => {
      const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
      const { view } = screenView();
      const { rerender } = render(<Activity mode="visible">{view}</Activity>);

      rerender(<Activity mode="hidden">{view}</Activity>);

      expect(pause).toHaveBeenCalledTimes(1);
    });
  });
});

describe("PlayerControls · 재생 막대와 자막", () => {
  describe("화면 표시", () => {
    it("영상 길이를 알면 질문 표시를 지난 · 지금 · 앞 질문으로 나눠 그린다", () => {
      const { markers } = renderControls({ time: 368.88 }, { current: 2 });

      expect(markers()).toEqual(["past", "past", "current", "upcoming", "upcoming"]);
    });

    it("답하지 않은 질문 구간이면 자막에 '답변하지 않은 질문이에요'를 보여 준다", () => {
      const items = ITEMS.map((item, i) => (i === 1 ? { ...item, answer: null } : item));

      renderControls({ time: 190 }, { current: 1, items });

      expect(screen.getByRole("region", { name: "자막" }).textContent).toBe(
        "자막 · 03:06답변하지 않은 질문이에요",
      );
    });

    it("첫 질문 전이면 자막을 보이지 않는다", () => {
      renderControls({ time: 10 }, { current: -1 });

      expect(screen.queryByRole("region", { name: "자막" })).toBeNull();
    });
  });

  describe("사용자 조작", () => {
    it("재생 위치 막대를 옮기면 그 위치(초)로 옮기기를 요청한다", () => {
      const { onSeek } = renderControls();

      fireEvent.change(screen.getByRole("slider", { name: "재생 위치" }), {
        target: { value: "605" },
      });

      expect(onSeek).toHaveBeenCalledWith(605);
    });
  });

  describe("경계값", () => {
    it("영상 길이를 모르면(0) 질문 표시를 그리지 않는다", () => {
      const { markers } = renderControls({ duration: 0 });

      expect(markers()).toEqual([]);
    });
  });
});
