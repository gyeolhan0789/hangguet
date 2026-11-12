// 기준: Figma S07-1 면접 다시보기(18:4478) · Swagger 6.4 ReplayResponse · 기획 메모 S07-1(18:3638: 질문 목록 클릭 → 영상이 해당
// 질문 시점으로 점프, 재생 중인 질문 강조) · API 명세 6.4 videoStatus(MERGING이면 처리 중 안내 + 10초마다 다시 조회, FAILED면 안내)
// · 사용자 결정(2026-10-22: 배속 1x → 1.5x → 2x → 1x) · 사용자 결정(2026-10-22: 인터넷이 끊기면 다시 조회하지 않는다)
// · 사용자 결정(2026-11-05: S07 [자세히 보기](q = 질문 순서)로 들어오면 그 질문을 펼치고 영상도 그 질문 시점에서 시작한다)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { router } from "@/test/next-navigation";
import { REPLAY } from "@/test/result-examples";

import { ReplayView } from "./replay-view";

// 경계 mock: Next 라우터(주소의 q · bfcacheId · 다시 그리기), 연출(motion)은 건너뛴다,
// 화면 폭(matchMedia) · 온라인 여부(navigator.onLine), jsdom에 없는 <video> 재생 상태와 그래프 상자 크기
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 6.4 200 예시 'S07-1 화상'(마커 00:38 · 03:06 · 06:08 · 10:01 · 14:26) · 채팅 · 녹화 상태
const CHAT = { ...REPLAY, mode: "CHAT" as const, videoStatus: null, videoUrl: null };
const MERGING = { ...REPLAY, videoStatus: "MERGING" as const, videoUrl: null };
const FAILED = { ...REPLAY, videoStatus: "FAILED" as const, videoUrl: null };
const NO_TIMELINE = {
  ...REPLAY,
  items: REPLAY.items.map((item) => ({ ...item, timeline: null })),
};
const POLL_MS = 10_000;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});

/** 주소의 질문 순서(q) */
function openWith(query: string) {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as ReadonlyURLSearchParams);
}

/** jsdom의 <video>에 재생 상태를 붙이고, play · pause는 부른 것만 기록한다 */
function fakeVideo() {
  const video = screen.getByLabelText("녹화 영상") as HTMLVideoElement;
  const state = { currentTime: 0, duration: Number.NaN, paused: true, playbackRate: 1 };
  for (const key of Object.keys(state) as (keyof typeof state)[]) {
    Object.defineProperty(video, key, {
      configurable: true,
      get: () => state[key],
      set: (value: never) => {
        state[key] = value;
      },
    });
  }
  const play = vi.fn(async () => {});
  const pause = vi.fn();
  Object.assign(video, { play, pause });
  return { video, state, play, pause };
}

/** 영상 길이를 알린다 */
function loadDuration(video: HTMLVideoElement, state: { duration: number }, duration: number) {
  state.duration = duration;
  fireEvent.durationChange(video);
}

const card = (name: RegExp) => screen.getByRole("button", { name });
const expanded = () => screen.queryAllByRole("button", { expanded: true });
const highlighted = () =>
  screen
    .getAllByRole("button", { name: /^Q\d/ })
    .filter((button) => button.getAttribute("aria-current") === "true");
const flowHeading = () => screen.queryByRole("heading", { name: "답변 흐름" });

describe("ReplayView · S07-1 면접 다시보기", () => {
  describe("머리말", () => {
    describe("화면 표시", () => {
      it("'결과로'는 그 면접 결과로 가고 면접관 · 회사 직무 · 한국 날짜를 보여 준다", () => {
        render(<ReplayView replay={REPLAY} />);

        expect(screen.getByRole("link", { name: "결과로" }).getAttribute("href")).toBe(
          "/interview/55/result",
        );
        expect(screen.getByText("악마 면접관 · ○○전자 백엔드 개발자 · 10월 15일")).toBeDefined();
      });
    });
  });

  describe("처음 펼칠 질문", () => {
    describe("화면 표시", () => {
      it("주소에 질문 순서(q)가 있으면 그 질문을 펼치고 영상을 그 질문 시점에서 시작한다", () => {
        openWith("q=3");

        render(<ReplayView replay={REPLAY} />);

        expect(expanded()).toEqual([card(/기술적 문제는/)]);
        expect((screen.getByLabelText("녹화 영상") as HTMLVideoElement).currentTime).toBe(368.88);
      });
    });

    describe("상태 변화", () => {
      it("새로 들어오면(bfcacheId 바뀜) 주소의 질문을 다시 펼친다", () => {
        const { rerender } = render(<ReplayView replay={REPLAY} />);
        fireEvent.click(card(/1분 자기소개/));

        router.bfcacheId = "entry-2";
        openWith("q=4");
        rerender(<ReplayView replay={REPLAY} />);

        expect(expanded()).toEqual([card(/지원한 이유는/)]);
      });
    });

    describe("경계값", () => {
      it("없는 질문 순서면 아무 질문도 펼치지 않는다", () => {
        openWith("q=9");

        render(<ReplayView replay={REPLAY} />);

        expect(expanded()).toHaveLength(0);
      });
    });
  });

  describe("질문 위치", () => {
    describe("사용자 조작", () => {
      it("녹화 시작 시각이 없으면 면접 시작 시각을 영상 0초로 보고 질문 위치를 잡는다", () => {
        render(<ReplayView replay={{ ...REPLAY, recordingStartedAt: null }} />);
        const { state } = fakeVideo();

        fireEvent.click(card(/기술적 문제는/));

        expect(card(/기술적 문제는/).textContent).toContain("06:12");
        expect(state.currentTime).toBe(372);
      });
    });
  });

  describe("질문 카드", () => {
    describe("사용자 조작", () => {
      it("영상이 있으면 질문 카드를 펼칠 때 영상을 그 질문 시점으로 옮긴다", () => {
        render(<ReplayView replay={REPLAY} />);
        const { state } = fakeVideo();

        fireEvent.click(card(/기술적 문제는/));

        expect(expanded()).toEqual([card(/기술적 문제는/)]);
        expect(state.currentTime).toBe(368.88);
      });

      it("펼친 카드를 다시 누르면 목록으로 접고 영상 위치는 그대로 둔다", () => {
        render(<ReplayView replay={REPLAY} />);
        const { state } = fakeVideo();
        fireEvent.click(card(/기술적 문제는/));

        fireEvent.click(card(/기술적 문제는/));

        expect(expanded()).toHaveLength(0);
        expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(5);
        expect(state.currentTime).toBe(368.88);
      });

      it("영상이 없으면 펼친 질문을 강조한다", () => {
        render(<ReplayView replay={CHAT} />);

        fireEvent.click(card(/트래픽 처리/));

        expect(highlighted()).toEqual([card(/트래픽 처리/)]);
      });
    });
  });

  describe("재생", () => {
    describe("사용자 조작", () => {
      it("멈춰 있을 때 [재생]을 누르면 영상을 재생한다", () => {
        render(<ReplayView replay={REPLAY} />);
        const { play } = fakeVideo();

        fireEvent.click(screen.getByRole("button", { name: "재생" }));

        expect(play).toHaveBeenCalledTimes(1);
      });

      it("재생 중에 [일시정지]를 누르면 영상을 멈춘다", () => {
        render(<ReplayView replay={REPLAY} />);
        const { video, state, pause } = fakeVideo();
        state.paused = false;
        fireEvent.play(video);

        fireEvent.click(screen.getByRole("button", { name: "일시정지" }));

        expect(pause).toHaveBeenCalledTimes(1);
      });

      it("배속 칩을 누를 때마다 1x · 1.5x · 2x · 1x 순으로 바꾼다", () => {
        render(<ReplayView replay={REPLAY} />);
        const { video } = fakeVideo();
        const chips: (string | null)[] = [];
        const press = () => {
          fireEvent.click(screen.getByRole("button", { name: /^재생 속도/ }));
          fireEvent.rateChange(video);
          chips.push(screen.getByRole("button", { name: /^재생 속도/ }).getAttribute("aria-label"));
        };

        press();
        press();
        press();

        expect(chips).toEqual(["재생 속도 1.5x", "재생 속도 2x", "재생 속도 1x"]);
      });
    });

    describe("상태 변화", () => {
      it("재생 위치가 바뀌면 그 위치가 속한 질문을 목록에서 강조한다", () => {
        render(<ReplayView replay={REPLAY} />);
        const { video, state } = fakeVideo();

        state.currentTime = 186.88;
        fireEvent.timeUpdate(video);

        expect(highlighted()).toEqual([card(/맡은 역할은/)]);
      });
    });

    describe("경계값", () => {
      it("영상 길이를 알 수 없으면(Infinity) 길이를 0으로 두고 나중에 길이가 오면 반영한다", () => {
        render(<ReplayView replay={REPLAY} />);
        const { video, state } = fakeVideo();

        loadDuration(video, state, Number.POSITIVE_INFINITY);
        expect(screen.getByText("00:00 / 00:00")).toBeDefined();
        loadDuration(video, state, 1080);

        expect(screen.getByText("00:00 / 18:00")).toBeDefined();
      });
    });
  });

  describe("답변 흐름", () => {
    describe("화면 표시", () => {
      it("영상 길이를 알면 답변 흐름을 그린다", () => {
        render(<ReplayView replay={REPLAY} />);
        const { video, state } = fakeVideo();

        loadDuration(video, state, 1080);

        expect(flowHeading()).not.toBeNull();
      });

      it("타임라인이 있는 답변이 없으면 답변 흐름을 그리지 않는다", () => {
        render(<ReplayView replay={NO_TIMELINE} />);
        const { video, state } = fakeVideo();

        loadDuration(video, state, 1080);

        expect(flowHeading()).toBeNull();
      });
    });

    describe("사용자 조작", () => {
      it("답변 흐름을 누르면 영상을 그 위치로 옮긴다", () => {
        render(<ReplayView replay={REPLAY} />);
        const { video, state } = fakeVideo();
        loadDuration(video, state, 1080);
        const chart = screen.getByTestId("replay-timeline-chart");
        vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
          left: 0,
          width: 1080 + 16,
        } as DOMRect);

        fireEvent.click(chart, { clientX: 8 + 100 });

        expect(state.currentTime).toBe(100);
      });
    });

    describe("경계값", () => {
      it("영상 길이를 알기 전에는 답변 흐름을 그리지 않는다", () => {
        render(<ReplayView replay={REPLAY} />);

        expect(flowHeading()).toBeNull();
      });
    });
  });

  describe("녹화 상태", () => {
    describe("화면 표시", () => {
      it.each([
        { label: "합치는 중", replay: MERGING, text: "영상을 업로드하는 중이에요" },
        { label: "채팅", replay: CHAT, text: "채팅 면접은 녹화 영상이 없어요" },
      ])(
        "녹화가 '$label'이면 플레이어 대신 안내를 두고 질문 목록은 보여 준다",
        ({ replay, text }) => {
          render(<ReplayView replay={replay} />);

          expect(screen.getByText(text)).toBeDefined();
          expect(screen.queryByLabelText("녹화 영상")).toBeNull();
          expect(screen.queryByRole("button", { name: "재생" })).toBeNull();
          expect(screen.getAllByRole("button", { name: /^Q\d/ })).toHaveLength(5);
        },
      );

      it("영상이 준비됐으면(READY) 안내 없이 플레이어를 보여 준다", () => {
        render(<ReplayView replay={REPLAY} />);

        expect(screen.getByLabelText("녹화 영상")).toBeDefined();
        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.queryByText("채팅 면접은 녹화 영상이 없어요")).toBeNull();
      });
    });

    describe("시간 경과", () => {
      it("합치는 중이면 10초마다 다시 조회한다", () => {
        vi.useFakeTimers();
        render(<ReplayView replay={MERGING} />);

        act(() => vi.advanceTimersByTime(POLL_MS - 1));
        expect(router.refresh).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(router.refresh).toHaveBeenCalledTimes(1);
        act(() => vi.advanceTimersByTime(POLL_MS));

        expect(router.refresh).toHaveBeenCalledTimes(2);
      });

      it("합치는 중이 아니면(실패) 다시 조회하지 않는다", () => {
        vi.useFakeTimers();
        render(<ReplayView replay={FAILED} />);

        act(() => vi.advanceTimersByTime(POLL_MS * 3));

        expect(router.refresh).not.toHaveBeenCalled();
      });

      it("합치는 중에 인터넷이 끊기면 조회를 멈췄다가 다시 연결되면 10초 뒤 조회한다", () => {
        vi.useFakeTimers();
        let online = false;
        vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
        render(<ReplayView replay={MERGING} />);
        act(() => vi.advanceTimersByTime(POLL_MS * 3));
        expect(router.refresh).not.toHaveBeenCalled();

        online = true;
        act(() => {
          window.dispatchEvent(new Event("online"));
        });
        act(() => vi.advanceTimersByTime(POLL_MS));

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });

    describe("정리", () => {
      it("화면을 벗어나면 예약한 다시 조회를 취소한다", () => {
        vi.useFakeTimers();
        const { unmount } = render(<ReplayView replay={MERGING} />);

        unmount();
        act(() => vi.advanceTimersByTime(POLL_MS * 3));

        expect(router.refresh).not.toHaveBeenCalled();
      });
    });
  });
});
