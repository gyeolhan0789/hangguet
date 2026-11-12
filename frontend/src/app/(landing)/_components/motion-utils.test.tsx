// 기준: Figma 랜딩 숫자 올리기(화면에 들어오면 0부터 목표까지) · 사용자 결정(2026-10-22: 동작 줄이기면 연출 없이 결과만)
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CountUp } from "./motion-utils";

// 경계 mock: 화면에 보이는지(IntersectionObserver — motion useInView가 쓴다) · 연출(motion: 동작 줄이기 켬)
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);
// 경계 mock: 프레임. 숫자 글자는 motion이 다음 프레임에 그린다. motion은 불러오는 순간 requestAnimationFrame을 잡아 두고
// (motion-dom frameloop) 한 번 건 프레임이 돌기 전에는 다시 걸지 않으므로, 그보다 먼저 테스트가 직접 돌리는 프레임 줄로 바꾼다
// (가짜 타이머는 테스트마다 풀려 그 사이에 건 프레임을 잃는다)
const frames = vi.hoisted(() => {
  const queue: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = (callback) => queue.push(callback);
  return queue;
});

/** 걸린 프레임을 모두 돌린다(돌다가 새로 건 프레임 포함) */
function runFrames() {
  act(() => {
    for (let callback = frames.shift(); callback; callback = frames.shift()) {
      callback(performance.now());
    }
  });
}

/** 테스트가 '화면에 들어옴'을 직접 알리는 IntersectionObserver 대역 */
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
  enter() {
    const entries = [...this.targets].map(
      (target) =>
        ({ target, isIntersecting: true, intersectionRatio: 1 }) as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  FakeIntersectionObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

describe("CountUp · 숫자 올리기", () => {
  describe("화면 표시", () => {
    it("동작 줄이기를 켜면 화면에 들어오자마자 목표 숫자를 보인다", () => {
      render(<CountUp to={30} prefix="+" />);

      act(() => {
        for (const observer of FakeIntersectionObserver.all) observer.enter();
      });

      runFrames();

      expect(screen.getByText("+30")).toBeDefined();
    });
  });
});
