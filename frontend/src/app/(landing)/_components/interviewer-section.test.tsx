// 기준: Figma 랜딩 면접관 소개 섹션(악마 면접관 · 개발자 커피챗을 3초마다 번갈아 고른다) · 사용자 결정(2026-10-22: 동작 줄이기면 멈춤)
import { act, render, screen } from "@testing-library/react";
import { useReducedMotion } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InterviewerSection } from "./interviewer-section";

// 경계 mock: 화면에 보이는지(IntersectionObserver — motion useInView가 쓴다) · 동작 줄이기 설정(useReducedMotion) · 3초 타이머
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: vi.fn(() => false),
}));

/** 테스트가 '화면에 들어옴 · 나감'을 직접 알리는 IntersectionObserver 대역 */
class FakeIntersectionObserver {
  static all: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
  notify(isIntersecting: boolean) {
    const entries = [...this.targets].map(
      (target) =>
        ({
          target,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
        }) as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  FakeIntersectionObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.useFakeTimers();
});

function scrollIntoView(isIntersecting = true) {
  act(() => {
    for (const observer of FakeIntersectionObserver.all) observer.notify(isIntersecting);
  });
}

function pass(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** 고른 면접관: 사진의 대체 텍스트가 고른 면접관 이름이다(나머지 사진은 alt="") */
const selected = () => screen.getAllByRole("img").map((image) => image.getAttribute("alt"));

describe("InterviewerSection · 면접관 소개 섹션", () => {
  describe("경계값", () => {
    it("마지막 면접관 다음에는 처음 면접관으로 돌아간다", () => {
      render(<InterviewerSection />);
      scrollIntoView();

      pass(6_000);

      expect(selected()).toContain("악마 면접관");
      expect(selected()).not.toContain("개발자 커피챗");
    });
  });

  describe("시간 경과", () => {
    it("화면에 보이는 동안 3초마다 고른 면접관을 바꾼다", () => {
      render(<InterviewerSection />);
      scrollIntoView();

      pass(2_999);
      expect(selected()).toContain("악마 면접관");

      pass(1);
      expect(selected()).toContain("개발자 커피챗");
    });

    it("화면에 들어오기 전에는 면접관을 바꾸지 않는다", () => {
      render(<InterviewerSection />);

      pass(3_000);

      expect(selected()).toContain("악마 면접관");
    });

    it("동작 줄이기를 켜면 면접관을 바꾸지 않는다", () => {
      vi.mocked(useReducedMotion).mockReturnValue(true);
      render(<InterviewerSection />);
      scrollIntoView();

      pass(3_000);

      expect(selected()).toContain("악마 면접관");
    });
  });

  describe("정리", () => {
    it("화면 밖으로 나가면 더 바꾸지 않는다", () => {
      render(<InterviewerSection />);
      scrollIntoView();

      scrollIntoView(false);
      pass(3_000);

      expect(selected()).toContain("악마 면접관");
    });
  });
});
