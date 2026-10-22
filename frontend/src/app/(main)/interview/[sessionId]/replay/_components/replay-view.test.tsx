import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REPLAY } from "@/test/result-examples";

import { ReplayView } from "./replay-view";

// 기준: Figma S07-1 면접 다시보기(18:4478) · 기획 메모 S07-1(18:3638: 질문 목록 클릭 → 영상이 해당 질문 시점으로 점프,
// 재생 중인 질문 강조 + 자막 동기화, 채팅은 영상 대신 대화 기록) · Swagger 6.4 200 예시(마커 00:42 · 03:10 · 06:12 · 10:05 · 14:30)
// · Figma S07-1 Timeline(18:4519: 지난 질문 · 지금 질문 · 앞 질문 마커) · API 명세 6.4(자막은 재생 위치가 속한 질문의 answer)
// · 사용자 결정(2026-10-22: 영상이 없으면 플레이어 없이 질문 목록과 답변 칸, 질문 카드를 누르면 펼쳐 답변을 보여 주고
//   다시 누르면 답변 칸 접기 → 카드 흔들기 → 제자리(펼칠 때보다 두 배 빠르게), 배속 1x → 1.5x → 2x → 1x)
// 영상 재생은 jsdom에 없어 <video>의 재생 위치 · 길이 · 배속을 테스트가 정하고 이벤트를 일으킨다. 실제 재생은 E2E가 본다.

// 동작 줄이기 설정과, 접을 때 카드 흔들기(animate)만 바꾼다.
// jsdom에서는 AnimatePresence의 퇴장 애니메이션이 끝나지 않아 사라진 요소가 남으므로, 들어오고 나가는 것만 보도록 바로 바꾼다.
const motion = vi.hoisted(() => ({ reduced: true, animate: vi.fn() }));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  motion.animate.mockImplementation(actual.animate);
  return {
    ...actual,
    useReducedMotion: () => motion.reduced,
    animate: (...args: unknown[]) => motion.animate(...args),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

beforeEach(() => {
  motion.reduced = true;
  // 넓은 화면(lg)
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** jsdom의 <video>에 재생 상태를 붙이고, play · pause는 부른 것만 기록한다. */
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

const card = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
/** 영상 위 질문 오버레이의 글(없으면 null) */
const overlay = () => {
  const screenArea = screen.getByLabelText("녹화 영상").parentElement!;
  return within(screenArea).queryByText(/^Q\d$/)?.parentElement?.textContent ?? null;
};
/** 강조한(재생 중인) 질문 카드들의 순번 */
const highlighted = () =>
  screen
    .getAllByRole("button", { name: /^Q\d/ })
    .filter((button) => button.getAttribute("aria-current") === "true")
    .map((button) => button.textContent?.slice(0, 2));
/** 타임라인 마커(지난 · 지금 · 앞 질문) */
const markers = () =>
  Array.from(
    screen
      .getByRole("slider", { name: "재생 위치" })
      .parentElement!.querySelectorAll<HTMLElement>("[data-marker]"),
  );

describe("ReplayView (S07-1 면접 다시보기)", () => {
  it("'‹ 결과로'는 S07로 가고, 면접관 · 회사 직무 · 면접 날짜(한국 시간)를 보여 준다", () => {
    render(<ReplayView replay={REPLAY} />);

    expect(screen.getByRole("link", { name: "결과로" }).getAttribute("href")).toBe(
      "/interview/55/result",
    );
    expect(screen.getByRole("heading", { level: 1, name: "면접 다시보기" })).toBeDefined();
    expect(screen.getByText("악마 면접관 · ○○전자 백엔드 개발자 · 10월 15일")).toBeDefined();
  });

  it("질문 목록은 질문 수 · 질문마다 순번 · 영상 속 위치 · 등급을 보여 주고, 처음에는 모두 접혀 있다", () => {
    render(<ReplayView replay={REPLAY} />);

    expect(screen.getByText("5개")).toBeDefined();
    const cards = screen.getAllByRole("button", { expanded: false });
    expect(cards.map((button) => button.textContent)).toEqual([
      "Q100:42좋아요1분 자기소개",
      "Q203:10좋아요○○ 프로젝트에서 맡은 역할은?",
      "Q306:12보통가장 큰 기술적 문제는?",
      "Q410:05아쉬워요백엔드 직무에 지원한 이유는?",
      "Q514:30좋아요대용량 트래픽 처리 방법은?",
    ]);
  });

  it("등급이 없는 질문(grade null)은 등급을 보여 주지 않는다", () => {
    const items = REPLAY.items.map((item, i) => (i === 0 ? { ...item, grade: null } : item));
    render(<ReplayView replay={{ ...REPLAY, items }} />);

    expect(card("1분 자기소개").textContent).toBe("Q100:421분 자기소개");
  });

  describe("영상이 있을 때(화상)", () => {
    it("질문 카드를 누르면 영상을 그 질문 시점으로 옮기고, 영상 위 질문 · 자막 · 카드 안에 그 질문의 답변을 보여 준다", () => {
      render(<ReplayView replay={REPLAY} />);
      const { state } = fakeVideo();

      fireEvent.click(card("기술적 문제는"));

      expect(state.currentTime).toBe(372);
      expect(card("기술적 문제는").getAttribute("aria-expanded")).toBe("true");
      expect(overlay()).toBe("Q3가장 큰 기술적 문제는?");
      expect(screen.getByRole("region", { name: "자막" }).textContent).toBe(
        "자막 · 06:12저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…",
      );
      const answerId = card("기술적 문제는").getAttribute("aria-controls")!;
      expect(document.getElementById(answerId)?.textContent).toBe(
        "저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…",
      );
    });

    it("재생 위치가 바뀌면 그 위치가 속한 질문(질문 시각 ≤ 위치 < 다음 질문)을 영상 위 · 자막 · 목록 강조로 보여 준다", () => {
      render(<ReplayView replay={REPLAY} />);
      const { video, state } = fakeVideo();

      state.currentTime = 41;
      fireEvent.timeUpdate(video);
      expect(overlay()).toBeNull();
      expect(screen.queryByRole("region", { name: "자막" })).toBeNull();
      expect(highlighted()).toEqual([]);

      state.currentTime = 189.9;
      fireEvent.timeUpdate(video);
      expect(overlay()).toBe("Q11분 자기소개");
      expect(highlighted()).toEqual(["Q1"]);

      state.currentTime = 190;
      fireEvent.timeUpdate(video);
      expect(overlay()).toBe("Q2○○ 프로젝트에서 맡은 역할은?");
      expect(screen.getByRole("region", { name: "자막" }).textContent).toContain("자막 · 03:10");
      expect(highlighted()).toEqual(["Q2"]);
    });

    it("답변이 없는 질문(answer null)을 재생 중이면 자막을 보여 주지 않는다", () => {
      const items = REPLAY.items.map((item, i) => (i === 1 ? { ...item, answer: null } : item));
      render(<ReplayView replay={{ ...REPLAY, items }} />);
      const { video, state } = fakeVideo();

      state.currentTime = 200;
      fireEvent.timeUpdate(video);

      expect(overlay()).toBe("Q2○○ 프로젝트에서 맡은 역할은?");
      expect(screen.queryByRole("region", { name: "자막" })).toBeNull();
    });

    it("영상 길이를 알면 타임라인에 질문 마커를 위치 비율대로 놓고, 지난 · 지금 · 앞 질문을 나눠 그린다", () => {
      render(<ReplayView replay={REPLAY} />);
      const { video, state } = fakeVideo();
      expect(markers()).toHaveLength(0);

      state.duration = 1080;
      fireEvent.loadedMetadata(video);
      state.currentTime = 372;
      fireEvent.timeUpdate(video);

      expect(markers().map((marker) => marker.style.left)).toEqual(
        [42, 190, 372, 605, 870].map((offset) => `${(offset / 1080) * 100}%`),
      );
      expect(markers().map((marker) => marker.dataset.marker)).toEqual([
        "past",
        "past",
        "current",
        "upcoming",
        "upcoming",
      ]);
    });

    it("영상 길이를 알면 '재생 위치 / 길이'를 보여 주고, 재생 위치 막대로 옮길 수 있다", () => {
      render(<ReplayView replay={REPLAY} />);
      const { video, state } = fakeVideo();
      expect(screen.getByText("00:00 / 00:00")).toBeDefined();

      state.duration = 1080;
      fireEvent.loadedMetadata(video);
      const slider = screen.getByRole("slider", { name: "재생 위치" });
      expect(slider.getAttribute("max")).toBe("1080");

      fireEvent.change(slider, { target: { value: "605" } });
      expect(state.currentTime).toBe(605);
      expect(screen.getByText("10:05 / 18:00")).toBeDefined();
    });

    it("화면이 그려지기 전에 영상 정보를 이미 받았으면(이벤트를 놓침) 처음에 길이를 읽어 둔다", () => {
      // 하이드레이션 전에 loadedmetadata가 지나간 경우. 그릴 때부터 영상 정보가 있는 <video>로 만든다.
      vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
      vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(1080);

      render(<ReplayView replay={REPLAY} />);

      expect(screen.getByText("00:00 / 18:00")).toBeDefined();
    });

    it("길이를 알 수 없으면(Infinity) 길이 0 · 마커 없음으로 두고, 나중에 길이가 오면 반영한다", () => {
      render(<ReplayView replay={REPLAY} />);
      const { video, state } = fakeVideo();

      state.duration = Number.POSITIVE_INFINITY;
      fireEvent.durationChange(video);
      expect(screen.getByText("00:00 / 00:00")).toBeDefined();
      expect(screen.getByRole("slider", { name: "재생 위치" }).getAttribute("max")).toBe("0");
      expect(markers()).toHaveLength(0);

      state.duration = 1080;
      fireEvent.durationChange(video);
      expect(screen.getByText("00:00 / 18:00")).toBeDefined();
      expect(markers()).toHaveLength(5);
    });

    it("[재생]은 영상을 재생하고, 재생 중이면 [일시정지]로 바뀌어 누르면 멈춘다", async () => {
      render(<ReplayView replay={REPLAY} />);
      const { video, state, play, pause } = fakeVideo();

      fireEvent.click(screen.getByRole("button", { name: "재생" }));
      expect(play).toHaveBeenCalledTimes(1);

      state.paused = false;
      await act(async () => {
        fireEvent.play(video);
      });
      fireEvent.click(screen.getByRole("button", { name: "일시정지" }));
      expect(pause).toHaveBeenCalledTimes(1);

      state.paused = true;
      fireEvent.pause(video);
      expect(screen.getByRole("button", { name: "재생" })).toBeDefined();
    });

    it("배속 칩은 누를 때마다 1x → 1.5x → 2x → 1x로 바꾼다", () => {
      render(<ReplayView replay={REPLAY} />);
      const { video, state } = fakeVideo();

      for (const rate of [1.5, 2, 1]) {
        fireEvent.click(screen.getByRole("button", { name: /^재생 속도/ }));
        expect(state.playbackRate).toBe(rate);
        fireEvent.rateChange(video);
        expect(screen.getByRole("button", { name: `재생 속도 ${rate}x` }).textContent).toBe(
          `${rate}x`,
        );
      }
    });
  });

  describe("영상이 없을 때(채팅 · videoUrl null)", () => {
    const CHAT = { ...REPLAY, mode: "CHAT" as const, videoUrl: null };

    it("플레이어 없이 질문 목록만 보여 준다", () => {
      render(<ReplayView replay={CHAT} />);

      expect(screen.queryByLabelText("녹화 영상")).toBeNull();
      expect(screen.queryByRole("button", { name: "재생" })).toBeNull();
      expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(5);
    });

    it("질문 카드를 누르면 펼쳐 답변을 보여 주고 강조하며, 다시 누르면 목록으로 접는다", () => {
      render(<ReplayView replay={CHAT} />);

      fireEvent.click(card("트래픽 처리"));
      expect(card("트래픽 처리").getAttribute("aria-expanded")).toBe("true");
      expect(highlighted()).toEqual(["Q5"]);
      const answerId = card("트래픽 처리").getAttribute("aria-controls")!;
      expect(document.getElementById(answerId)?.textContent).toBe("읽기 부하는 캐시로…");

      fireEvent.click(card("트래픽 처리"));
      expect(card("트래픽 처리").getAttribute("aria-expanded")).toBe("false");
    });

    it("답변이 없는 질문(answer null)은 펼쳐도 답변 칸이 없다", () => {
      const items = REPLAY.items.map((item, i) => (i === 0 ? { ...item, answer: null } : item));
      render(<ReplayView replay={{ ...CHAT, items }} />);

      fireEvent.click(card("1분 자기소개"));

      expect(card("1분 자기소개").getAttribute("aria-expanded")).toBe("true");
      expect(card("1분 자기소개").hasAttribute("aria-controls")).toBe(false);
    });

    it("접을 때는 카드를 흔든 뒤(펼칠 때의 절반 시간) 목록으로 돌아가고, 흔드는 동안 다시 눌러도 무시한다", async () => {
      motion.reduced = false;
      // 답변 칸이 없는 질문은 접을 때 바로 카드를 흔든다. 흔들기가 끝나는 때를 테스트가 정한다.
      const items = REPLAY.items.map((item, i) => (i === 0 ? { ...item, answer: null } : item));
      render(<ReplayView replay={{ ...CHAT, items }} />);
      fireEvent.click(card("1분 자기소개"));
      let finish!: () => void;
      motion.animate.mockImplementationOnce(() => new Promise<void>((done) => (finish = done)));

      fireEvent.click(card("1분 자기소개"));
      fireEvent.click(card("1분 자기소개"));

      expect(motion.animate).toHaveBeenCalledTimes(1);
      expect(motion.animate).toHaveBeenCalledWith(
        expect.anything(),
        [0, 6, -2, 0],
        expect.objectContaining({ duration: 0.2 }),
      );
      expect(card("1분 자기소개").getAttribute("aria-expanded")).toBe("true");

      await act(async () => finish());

      expect(card("1분 자기소개").getAttribute("aria-expanded")).toBe("false");
    });
  });
});
