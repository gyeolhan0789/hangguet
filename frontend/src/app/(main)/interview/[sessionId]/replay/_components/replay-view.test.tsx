import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_ANSWER } from "@/lib/result/format";
import { REPLAY } from "@/test/result-examples";

import { REPLAY_POLL_MS, ReplayView } from "./replay-view";

// 기준: Figma S07-1 면접 다시보기(18:4478) · 기획 메모 S07-1(18:3638: 질문 목록 클릭 → 영상이 해당 질문 시점으로 점프,
// 재생 중인 질문 강조 + 자막 동기화, 채팅은 영상 대신 대화 기록) · Swagger 6.4 200 예시(마커 00:38 · 03:06 · 06:08 · 10:01 · 14:26)
// · Figma S07-1 Timeline(18:4519: 지난 질문 · 지금 질문 · 앞 질문 마커) · 웹 Swagger 6.4(화상은 녹화 영상과 질문별 시점) · 자막은 재생 위치가 속한 질문의 answer
// · 사용자 결정(2026-10-22: 영상이 없으면 플레이어 없이 질문 목록과 답변 칸, 질문 카드를 누르면 펼쳐 답변을 보여 주고
//   다시 누르면 답변 칸 접기 → 카드 흔들기 → 제자리(펼칠 때보다 두 배 빠르게), 배속 1x → 1.5x → 2x → 1x)
// 영상 재생은 jsdom에 없어 <video>의 재생 위치 · 길이 · 배속을 테스트가 정하고 이벤트를 일으킨다. 실제 재생은 E2E가 본다.

// 동작 줄이기 설정과, 접을 때 카드 흔들기(animate)만 바꾼다.
// jsdom에서는 AnimatePresence의 퇴장 애니메이션이 끝나지 않아 사라진 요소가 남으므로, 들어오고 나가는 것만 보도록 바로 바꾼다.
// 있던 자식이 사라지는 순간에만 퇴장이 바로 끝난 것으로 보고 onExitComplete를 한 번 부른다(motion의 계약과 같게).
const motion = vi.hoisted(() => ({
  reduced: true,
  animate: vi.fn(),
  actualAnimate: undefined as unknown,
}));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { useEffect, useRef } = await import("react");
  motion.actualAnimate = actual.animate;
  motion.animate.mockImplementation(actual.animate);
  return {
    ...actual,
    useReducedMotion: () => motion.reduced,
    animate: (...args: unknown[]) => motion.animate(...args),
    AnimatePresence: ({
      children,
      onExitComplete,
    }: {
      children: React.ReactNode;
      onExitComplete?: () => void;
    }) => {
      const hadChildren = useRef(Boolean(children));
      useEffect(() => {
        const has = Boolean(children);
        if (hadChildren.current && !has) onExitComplete?.();
        hadChildren.current = has;
      }, [children, onExitComplete]);
      return children;
    },
  };
});

// 다시 그리기(6.4 다시 조회)는 경계다. 부른 횟수만 본다.
// 주소의 질문(q)과 bfcacheId(새로 들어올 때마다 바뀌고 뒤로 · 앞으로 가기에는 그대로)는 테스트가 정한다.
const refresh = vi.fn();
const nav = vi.hoisted(() => ({ bfcacheId: "entry-1", query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, bfcacheId: nav.bfcacheId }),
  useSearchParams: () => new URLSearchParams(nav.query),
}));

beforeEach(() => {
  refresh.mockReset();
  nav.bfcacheId = "entry-1";
  nav.query = "";
  motion.reduced = true;
  // 흔들기(animate) 기록과 남은 once 구현을 테스트마다 비우고 실제 animate로 되돌린다.
  motion.animate
    .mockReset()
    .mockImplementation(motion.actualAnimate as (...args: unknown[]) => unknown);
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
      "Q100:38좋아요1분 자기소개",
      "Q203:06좋아요○○ 프로젝트에서 맡은 역할은?",
      "Q306:08보통가장 큰 기술적 문제는?",
      "Q410:01아쉬워요백엔드 직무에 지원한 이유는?",
      "Q514:26좋아요대용량 트래픽 처리 방법은?",
    ]);
  });

  // 기준: 사용자 결정(2026-11-05: S07 [자세히 보기](q = 질문 순서)로 들어오면 그 질문을 펼치고 영상도 그 시점에서 시작)
  describe("S07 [자세히 보기]로 들어올 때(q)", () => {
    it("그 질문을 펼치고, 영상도 그 질문 시점에서 시작한다", () => {
      nav.query = "q=3";
      render(<ReplayView replay={REPLAY} />);

      expect(card("기술적 문제는").getAttribute("aria-expanded")).toBe("true");
      expect((screen.getByLabelText("녹화 영상") as HTMLVideoElement).currentTime).toBe(368.88);
      expect(overlay()).toBe("Q3가장 큰 기술적 문제는?");
    });

    it("영상이 없으면(채팅) 그 질문만 펼친다", () => {
      nav.query = "q=5";
      render(<ReplayView replay={{ ...REPLAY, videoStatus: null, videoUrl: null }} />);

      expect(card("트래픽 처리").getAttribute("aria-expanded")).toBe("true");
      expect(highlighted()).toEqual(["Q5"]);
    });

    it("없는 질문 순서면 아무것도 펼치지 않는다", () => {
      nav.query = "q=9";
      render(<ReplayView replay={REPLAY} />);

      expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(5);
    });

    // Next.js는 한 번 본 화면을 숨겨 두었다가 다시 보여 주므로(Activity) 펼친 질문이 남는다.
    it("새로 들어오면(bfcacheId가 바뀜) 주소의 질문을 펼치고, 뒤로 가기로 돌아오면(같은 bfcacheId) 펼쳐 둔 질문을 그대로 둔다", () => {
      const { rerender } = render(<ReplayView replay={REPLAY} />);
      fireEvent.click(card("1분 자기소개"));

      rerender(<ReplayView replay={REPLAY} />);
      expect(card("1분 자기소개").getAttribute("aria-expanded")).toBe("true");

      nav.bfcacheId = "entry-2";
      nav.query = "q=4";
      rerender(<ReplayView replay={REPLAY} />);
      expect(card("지원한 이유는").getAttribute("aria-expanded")).toBe("true");
      expect(screen.queryByRole("button", { name: /1분 자기소개/ })).toBeNull();
    });
  });

  describe("영상이 있을 때(화상)", () => {
    it("질문 카드를 누르면 영상을 그 질문 시점으로 옮기고, 영상 위 질문 · 자막 · 카드 안에 그 질문의 답변을 보여 준다", () => {
      render(<ReplayView replay={REPLAY} />);
      const { state } = fakeVideo();

      fireEvent.click(card("기술적 문제는"));

      expect(state.currentTime).toBe(368.88);
      expect(card("기술적 문제는").getAttribute("aria-expanded")).toBe("true");
      expect(overlay()).toBe("Q3가장 큰 기술적 문제는?");
      expect(screen.getByRole("region", { name: "자막" }).textContent).toBe(
        "자막 · 06:08저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…",
      );
      const answerId = card("기술적 문제는").getAttribute("aria-controls")!;
      expect(document.getElementById(answerId)?.textContent).toBe(
        "저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…",
      );
    });

    it("녹화 시작 시각이 없으면(이전 면접) 면접 시작 시각을 영상 0초로 보고 질문 위치를 잡는다", () => {
      render(<ReplayView replay={{ ...REPLAY, recordingStartedAt: null }} />);
      const { state } = fakeVideo();

      expect(card("1분 자기소개").textContent).toContain("00:42");
      fireEvent.click(card("기술적 문제는"));

      expect(state.currentTime).toBe(372);
    });

    it("재생 위치가 바뀌면 그 위치가 속한 질문(질문 시각 ≤ 위치 < 다음 질문)을 영상 위 · 자막 · 목록 강조로 보여 준다", () => {
      render(<ReplayView replay={REPLAY} />);
      const { video, state } = fakeVideo();

      state.currentTime = 38;
      fireEvent.timeUpdate(video);
      expect(overlay()).toBeNull();
      expect(screen.queryByRole("region", { name: "자막" })).toBeNull();
      expect(highlighted()).toEqual([]);

      state.currentTime = 186.8;
      fireEvent.timeUpdate(video);
      expect(overlay()).toBe("Q11분 자기소개");
      expect(highlighted()).toEqual(["Q1"]);

      state.currentTime = 186.88;
      fireEvent.timeUpdate(video);
      expect(overlay()).toBe("Q2○○ 프로젝트에서 맡은 역할은?");
      expect(screen.getByRole("region", { name: "자막" }).textContent).toContain("자막 · 03:06");
      expect(highlighted()).toEqual(["Q2"]);
    });

    it("답하지 않은 질문 구간의 자막은 안내 문구다", () => {
      const replay = {
        ...REPLAY,
        items: REPLAY.items.map((item, i) => (i === 1 ? { ...item, answer: null } : item)),
      };
      render(<ReplayView replay={replay} />);
      const { video, state } = fakeVideo();

      state.currentTime = 186.88;
      fireEvent.timeUpdate(video);

      expect(screen.getByRole("region", { name: "자막" }).textContent).toBe(
        `자막 · 03:06${NO_ANSWER}`,
      );
    });

    it("영상 길이를 알면 타임라인에 질문 마커를 위치 비율대로 놓고, 지난 · 지금 · 앞 질문을 나눠 그린다", () => {
      render(<ReplayView replay={REPLAY} />);
      const { video, state } = fakeVideo();
      expect(markers()).toHaveLength(0);

      state.duration = 1080;
      fireEvent.loadedMetadata(video);
      state.currentTime = 368.88;
      fireEvent.timeUpdate(video);

      expect(markers().map((marker) => marker.style.left)).toEqual(
        [38.88, 186.88, 368.88, 601.88, 866.88].map((offset) => `${(offset / 1080) * 100}%`),
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

    // Next.js는 다른 화면으로 가면 이 화면을 <Activity>로 숨긴다(Preserving UI State). 숨겨도 영상은 저절로 멈추지 않는다.
    // 돌아왔을 때 보던 위치가 남는지는 실제 영상이 있어야 해서 E2E가 본다.
    it("다른 화면으로 가 숨겨지면 영상을 멈춘다", () => {
      const { rerender } = render(
        <Activity mode="visible">
          <ReplayView replay={REPLAY} />
        </Activity>,
      );
      const { pause } = fakeVideo();

      rerender(
        <Activity mode="hidden">
          <ReplayView replay={REPLAY} />
        </Activity>,
      );

      expect(pause).toHaveBeenCalledTimes(1);
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
    const CHAT = { ...REPLAY, mode: "CHAT" as const, videoStatus: null, videoUrl: null };

    it("플레이어 대신 영상 자리에 녹화 영상이 없다는 문구를 두고 질문 목록을 보여 준다", () => {
      render(<ReplayView replay={CHAT} />);

      expect(screen.getByText("채팅 면접은 녹화 영상이 없어요")).toBeTruthy();

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

    it("접을 때는 카드를 흔든 뒤(펼칠 때의 절반 시간) 목록으로 돌아가고, 흔드는 동안 다시 눌러도 무시한다", async () => {
      motion.reduced = false;
      // 답변 칸이 접히면(퇴장 끝) 카드를 흔든다. 흔들기가 끝나는 때를 테스트가 정한다.
      render(<ReplayView replay={CHAT} />);
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

    // 기준: 사용자 결정(2026-10-28: 답하지 않은 질문(answer null)도 펼쳐 '답변하지 않은 질문이에요'를 보여 준다)
    const UNANSWERED = {
      ...CHAT,
      items: CHAT.items.map((item, i) =>
        i === 4 ? { ...item, answer: null, answerCreatedAt: null, grade: null } : item,
      ),
    };

    it("답하지 않은 질문을 펼치면 답변 칸에 안내를 보여 주고, 등급은 비워 둔다", () => {
      render(<ReplayView replay={UNANSWERED} />);

      expect(card("트래픽 처리").textContent).not.toMatch(/좋아요|보통|아쉬워요/);
      fireEvent.click(card("트래픽 처리"));

      const answerId = card("트래픽 처리").getAttribute("aria-controls")!;
      expect(document.getElementById(answerId)?.textContent).toBe(NO_ANSWER);
    });

    it("답하지 않은 질문도 다시 누르면 카드를 흔든 뒤 목록으로 접힌다", async () => {
      motion.reduced = false;
      render(<ReplayView replay={UNANSWERED} />);
      fireEvent.click(card("트래픽 처리"));
      let finish!: () => void;
      motion.animate.mockImplementationOnce(() => new Promise<void>((done) => (finish = done)));

      fireEvent.click(card("트래픽 처리"));
      await act(async () => {});
      expect(motion.animate).toHaveBeenCalledWith(
        expect.anything(),
        [0, 6, -2, 0],
        expect.objectContaining({ duration: 0.2 }),
      );

      await act(async () => finish());

      expect(card("트래픽 처리").getAttribute("aria-expanded")).toBe("false");
      expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(5);
    });
  });
});

// 기준: 웹 Swagger 6.4 items[].timeline(4번 질문 체크포인트 623.25초: 자신감 · 군말 3회) · 사용자 결정(2026-10-30: 그래프를 누르면
// 영상이 그 위치로 가고, 누른 곳 가까이에 체크포인트가 있으면 그래프 아래에 그 지점의 보완할 점만 이유별로 보여 준다)
// jsdom은 레이아웃이 없어 그래프 상자의 위치 · 크기를 테스트가 정한다(좌우 여백 8px, 1px = 1초).
describe("ReplayView · 다시보기 타임라인", () => {
  function shown() {
    render(<ReplayView replay={REPLAY} />);
    const { video, state } = fakeVideo();
    state.duration = 1080;
    fireEvent.loadedMetadata(video);
    const chart = screen.getByTestId("replay-timeline-chart");
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 1080 + 16,
    } as DOMRect);
    return { chart, state };
  }

  it("영상 길이를 알면 답변 흐름을 그리고, 처음에는 빨간 점을 누르라는 안내만 둔다", () => {
    shown();

    expect(screen.getByRole("heading", { name: "답변 흐름" })).toBeDefined();
    expect(
      screen.getByText("그래프의 빨간 점을 누르면 그 지점에서 보완할 점이 나와요."),
    ).toBeDefined();
  });

  it("체크포인트 가까이를 누르면 영상이 그 위치로 가고, 그 지점의 보완할 점을 이유별로 보여 준다", () => {
    const { chart, state } = shown();

    fireEvent.click(chart, { clientX: 8 + 625 });

    expect(state.currentTime).toBe(625);
    expect(screen.getByText("10:23 보완할 점")).toBeDefined();
    expect(screen.getByText("자신감")).toBeDefined();
    expect(screen.getByText("고개가 숙여졌어요. 화면 속 면접관을 보며 말해 보세요.")).toBeDefined();
    expect(screen.getByText("군말 3회")).toBeDefined();
  });

  it("체크포인트에서 먼 곳을 누르면 영상만 옮기고 보완할 점은 닫는다", () => {
    const { chart, state } = shown();
    fireEvent.click(chart, { clientX: 8 + 623 });

    fireEvent.click(chart, { clientX: 8 + 100 });

    expect(state.currentTime).toBe(100);
    expect(screen.queryByText("10:23 보완할 점")).toBeNull();
    expect(
      screen.getByText("그래프의 빨간 점을 누르면 그 지점에서 보완할 점이 나와요."),
    ).toBeDefined();
  });

  it("타임라인이 있는 답변이 없으면 답변 흐름을 그리지 않는다", () => {
    const replay = { ...REPLAY, items: REPLAY.items.map((item) => ({ ...item, timeline: null })) };
    render(<ReplayView replay={replay} />);
    const { video, state } = fakeVideo();
    state.duration = 1080;
    fireEvent.loadedMetadata(video);

    expect(screen.queryByRole("heading", { name: "답변 흐름" })).toBeNull();
  });
});

// 기준: API 명세 6.4 videoStatus(MERGING: 플레이어 자리에 처리 중 안내 + 10초마다 다시 조회, FAILED: 불러오지 못했다고 안내,
// 두 경우 모두 질문 목록과 답변은 보여 준다) · S15P31A301-259
describe("ReplayView · 녹화 상태(videoStatus)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const merging = { ...REPLAY, videoStatus: "MERGING" as const, videoUrl: null };
  const failed = { ...REPLAY, videoStatus: "FAILED" as const, videoUrl: null };

  it("합치는 중(MERGING)이면 플레이어 대신 처리 중임을 알리고, 질문 목록과 답변은 그대로 보여 준다", () => {
    render(<ReplayView replay={merging} />);
    expect(screen.getByRole("status").textContent).toBe("영상을 업로드하는 중이에요");
    expect(screen.queryByLabelText("녹화 영상")).toBeNull();
    expect(screen.queryByRole("slider", { name: "재생 위치" })).toBeNull();

    fireEvent.click(card("가장 큰 기술적 문제는"));
    expect(screen.getByText(REPLAY.items[2].answer)).toBeTruthy();
  });

  it("합치는 중이면 10초마다 6.4를 다시 조회한다", () => {
    render(<ReplayView replay={merging} />);
    act(() => vi.advanceTimersByTime(REPLAY_POLL_MS - 1));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(REPLAY_POLL_MS));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("합치는 중이어도 인터넷이 끊기면 다시 조회하지 않고, 다시 연결되면 이어서 10초 뒤 조회한다", () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    render(<ReplayView replay={merging} />);
    act(() => vi.advanceTimersByTime(REPLAY_POLL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();

    online = true;
    act(() => window.dispatchEvent(new Event("online")));
    act(() => vi.advanceTimersByTime(REPLAY_POLL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("합치기가 끝나 영상이 오면(READY) 조회를 멈추고 플레이어를 보여 준다", () => {
    const { rerender } = render(<ReplayView replay={merging} />);
    rerender(<ReplayView replay={REPLAY} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("녹화 영상")).toBeTruthy();
    act(() => vi.advanceTimersByTime(REPLAY_POLL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("합치기에 실패했으면(FAILED) 불러오지 못했다고 알리고 다시 조회하지 않으며, 질문 목록과 답변은 보여 준다", () => {
    render(<ReplayView replay={failed} />);
    expect(screen.getByRole("status").textContent).toBe("녹화를 불러오지 못했어요");
    expect(screen.queryByLabelText("녹화 영상")).toBeNull();
    act(() => vi.advanceTimersByTime(REPLAY_POLL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(card("가장 큰 기술적 문제는"));
    expect(screen.getByText(REPLAY.items[2].answer)).toBeTruthy();
  });

  it("채팅(videoStatus null)은 상태 알림 없이 영상 없음 문구만 두고 다시 조회하지 않는다", () => {
    render(<ReplayView replay={{ ...REPLAY, mode: "CHAT", videoStatus: null, videoUrl: null }} />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(REPLAY_POLL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
  });
});
