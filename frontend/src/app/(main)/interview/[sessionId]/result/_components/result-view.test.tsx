import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RESULT } from "@/test/result-examples";

import { ResultView } from "./result-view";

// 기준: Figma S07 피드백 결과(18:2620) · 기획 메모 S07(18:762) · 모션 메모 S07(18:2705: 하단 [오늘의 성장 리뷰 보기]는
// 페이지 끝에 닿으면 한 번 통통) · Swagger 6.3 200 예시
// · 기준 이름 · 등급 문구는 화면이 바꾸고, 질문별 피드백은 첫 번째 WEAK · NORMAL 질문만 펼친다
// · 사용자 결정(2026-10-22: [전체 펼치기] ↔ '전체 접기', 펼친 질문의 [자세히 보기] → S07-1, [오늘의 성장 리뷰 보기]는 면접이 끝난 날의 성장 리뷰(S08)로)
// 화면에 보이는 것과 이동 주소만 본다. 실제 6.3 요청 · 화면 이동은 E2E(result.spec.ts)가 본다.

// 동작 줄이기 설정과, 하단 버튼 통통(useAnimate의 animate)만 바꾼다. 나머지 motion은 그대로 쓴다.
const motion = vi.hoisted(() => ({ reduced: true, bounce: vi.fn() }));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { useRef } = await import("react");
  return {
    ...actual,
    useReducedMotion: () => motion.reduced,
    useAnimate: () => [useRef(null), motion.bounce],
  };
});

/** 페이지 끝이 보이는지 알리는 IntersectionObserver(jsdom에 없다). 테스트가 '보였다'를 직접 알린다. */
const observers: { callback: IntersectionObserverCallback; targets: Element[] }[] = [];

function reachEnd() {
  act(() => {
    for (const { callback, targets } of observers) {
      callback(
        targets.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry),
        {} as IntersectionObserver,
      );
    }
  });
}

beforeEach(() => {
  motion.reduced = true;
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private entry: (typeof observers)[number];
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, targets: [] };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.push(target);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const question = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
const QUESTIONS = ["1분 자기소개", "맡은 역할은", "기술적 문제는", "지원한 이유는", "트래픽 처리"];

describe("ResultView (S07 피드백 결과)", () => {
  it("맨 위에 면접관 · 회사 직무 · 면접 시간, 한 줄 총평, 면접관 썸네일을 보여 준다", () => {
    render(<ResultView result={RESULT} />);

    expect(screen.getByText("악마 면접관 · ○○전자 백엔드 개발자 · 18분")).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 1, name: "논리는 탄탄했지만, 근거가 조금 아쉬웠어요" }),
    ).toBeDefined();
    expect(screen.getByRole("img", { name: "악마 면접관" })).toBeDefined();
  });

  it("총평이 없으면(null) 총평 줄을 그리지 않는다", () => {
    render(<ResultView result={{ ...RESULT, summary: null }} />);

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("평가 기준 4칸을 점수 대신 '좋아요 · 보통 · 아쉬워요'로 보여 주고, '아쉬워요'만 빨간색이다", () => {
    render(<ResultView result={RESULT} />);

    const cells = within(screen.getByRole("list", { name: "평가 기준" })).getAllByRole("listitem");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "직무 적합성좋아요",
      "자소서 검증아쉬워요",
      "논리성좋아요",
      "전달력보통",
    ]);
    expect(within(cells[1]).getByText("아쉬워요").className).toContain("text-danger");
    expect(within(cells[0]).getByText("좋아요").className).not.toContain("text-danger");
    expect(within(cells[3]).getByText("보통").className).not.toContain("text-danger");
  });

  it("처음에는 첫 번째 '보통' · '아쉬워요' 질문(Q3)만 펼쳐 잘한 점 · 아쉬운 점을 보여 준다", () => {
    render(<ResultView result={RESULT} />);

    expect(QUESTIONS.map((name) => question(name).getAttribute("aria-expanded"))).toEqual([
      "false",
      "false",
      "true",
      "false",
      "false",
    ]);
    expect(screen.getByText("문제 상황을 명확히 설명했어요")).toBeDefined();
    expect(screen.getByText("해결 방법을 고른 이유가 빠졌어요")).toBeDefined();
  });

  it("모두 '좋아요'면 처음에 아무 질문도 펼치지 않는다", () => {
    const answers = RESULT.answers.map((answer) => ({ ...answer, grade: "GOOD" as const }));
    render(<ResultView result={{ ...RESULT, answers }} />);

    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });

  it("질문을 누르면 펼치고 다시 누르면 접는다. 잘한 점이 없으면(null) 아쉬운 점만 보여 준다", () => {
    render(<ResultView result={RESULT} />);

    fireEvent.click(question("지원한 이유는"));
    expect(question("지원한 이유는").getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(
      question("지원한 이유는").getAttribute("aria-controls")!,
    )!;
    expect(within(panel).queryByText("잘한 점")).toBeNull();
    expect(within(panel).getByText("자소서 내용과 연결하지 못했어요")).toBeDefined();

    fireEvent.click(question("기술적 문제는"));
    expect(question("기술적 문제는").getAttribute("aria-expanded")).toBe("false");
  });

  it("[전체 펼치기]는 모두 펼치고 '전체 접기'로 바뀌며, 다시 누르면 모두 접는다", () => {
    render(<ResultView result={RESULT} />);

    fireEvent.click(screen.getByRole("button", { name: "전체 펼치기" }));
    expect(QUESTIONS.every((name) => question(name).getAttribute("aria-expanded") === "true")).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "전체 접기" }));
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "전체 펼치기" })).toBeDefined();
  });

  it("질문을 하나씩 모두 펼쳐도 '전체 접기'로 바뀐다", () => {
    render(<ResultView result={RESULT} />);

    for (const name of QUESTIONS) {
      if (question(name).getAttribute("aria-expanded") === "false") fireEvent.click(question(name));
    }

    expect(screen.getByRole("button", { name: "전체 접기" })).toBeDefined();
  });

  it("펼친 질문의 [자세히 보기] · 아래 [면접 다시보기]는 S07-1로, [오늘의 성장 리뷰 보기]는 면접을 시작한 날(한국 시간)의 S08로 간다", () => {
    render(<ResultView result={RESULT} />);

    expect(screen.getByRole("link", { name: "자세히 보기" }).getAttribute("href")).toBe(
      "/interview/55/replay",
    );
    expect(screen.getByRole("link", { name: "면접 다시보기" }).getAttribute("href")).toBe(
      "/interview/55/replay",
    );
    // 예시 startedAt 2026-10-15T12:00:00+09:00
    expect(screen.getByRole("link", { name: "오늘의 성장 리뷰 보기" }).getAttribute("href")).toBe(
      "/reviews/2026-10-15?from=result",
    );
  });

  // 성장 리뷰는 면접을 시작한 날(한국 시간) 기준이다. 자정을 넘어 끝나도 시작일이다(웹 Swagger 7.1).
  it.each([
    ["한국 시간 23:59(UTC 14:59)에 시작하면 그날", "2026-10-15T14:59:00Z", "2026-10-15"],
    ["한국 시간 자정(UTC 15:00)에 시작하면 다음 날", "2026-10-15T15:00:00Z", "2026-10-16"],
  ])("%s의 성장 리뷰로 간다(끝난 시각 00:30과 상관없이)", (_, startedAt, date) => {
    render(<ResultView result={{ ...RESULT, startedAt, endedAt: "2026-10-15T15:30:00Z" }} />);

    expect(screen.getByRole("link", { name: "오늘의 성장 리뷰 보기" }).getAttribute("href")).toBe(
      `/reviews/${date}?from=result`,
    );
  });

  describe("[오늘의 성장 리뷰 보기] 통통(모션 메모 S07)", () => {
    it("페이지 끝에 닿으면 한 번만 통통 튄다(다시 닿아도 한 번)", () => {
      motion.reduced = false;
      render(<ResultView result={RESULT} />);
      expect(motion.bounce).not.toHaveBeenCalled();

      reachEnd();
      reachEnd();

      expect(motion.bounce).toHaveBeenCalledTimes(1);
      // 1 → 1.06 → 1을 두 번에 나눠 움직인다(Motion 14 버그를 피하려고).
      const button = screen.getByRole("link", { name: "오늘의 성장 리뷰 보기" });
      expect(motion.bounce).toHaveBeenCalledWith([
        [button, { scale: 1.06 }, { duration: 0.2, ease: "easeOut" }],
        [button, { scale: 1 }, { duration: 0.2, ease: "easeIn" }],
      ]);
    });

    it("동작 줄이기를 켰으면 튀지 않는다", () => {
      render(<ResultView result={RESULT} />);

      reachEnd();

      expect(motion.bounce).not.toHaveBeenCalled();
    });
  });
});
