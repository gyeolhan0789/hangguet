// 기준: Figma S07-1 Question List(18:4533) · 재생 중인 줄(18:4552) · 기획 메모 S07-1(18:3638: 질문 목록 클릭 → 영상 점프,
// 재생 중인 질문 강조) · ReplayItem(seq · question · answer · grade)
// · 사용자 결정(2026-10-22: 펼치면 그 카드만 맨 위에 두고 아래에 답변, 접으면 답변 칸을 접고 카드를 흔든 뒤 제자리로)
// · 사용자 결정(2026-10-28: 답하지 않은 질문도 펼쳐 '답변하지 않은 질문이에요'를 보여 준다)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "@/test/deferred";
import { REPLAY } from "@/test/result-examples";

import { ReplayQuestions } from "./replay-questions";

// 경계 mock: 연출(motion). 동작 줄이기 여부는 테스트가 정하고, 카드 흔들기(animate)는 테스트가 끝내는 시점을 정한다
const motionState = vi.hoisted(() => ({
  reduce: true,
  shakes: [] as (() => void)[],
}));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
  useReducedMotion: () => motionState.reduce,
  animate: () => {
    const done = deferred();
    motionState.shakes.push(() => done.resolve());
    return {
      then: (onDone: () => void, onError: (reason: unknown) => void) =>
        done.promise.then(onDone, onError),
      stop: vi.fn(),
    };
  },
}));

// 예시 데이터: Swagger 6.4 200 예시(마커 00:38 · 03:06 · 06:08 · 10:01 · 14:26)
const OFFSETS = [38.88, 186.88, 368.88, 601.88, 866.88];
const UNANSWERED = REPLAY.items.map((item, i) =>
  i === 4 ? { ...item, answer: null, answerCreatedAt: null, grade: null } : item,
);

function renderQuestions({
  items = REPLAY.items,
  opened = -1,
}: {
  items?: typeof REPLAY.items | typeof UNANSWERED;
  opened?: number;
} = {}) {
  const onToggle = vi.fn();
  render(
    <ReplayQuestions
      items={items}
      offsets={OFFSETS}
      highlighted={-1}
      opened={opened}
      onToggle={onToggle}
      fill={false}
    />,
  );
  return { onToggle };
}

const card = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  motionState.reduce = true;
  motionState.shakes = [];
});

describe("ReplayQuestions · 다시보기 질문 목록", () => {
  describe("화면 표시", () => {
    it("펼친 질문이 없으면 '질문'과 질문 수를 머리에 두고 모든 카드를 보여 준다", () => {
      renderQuestions();

      expect(screen.getByRole("heading", { name: "질문" })).toBeDefined();
      expect(screen.getByText("5개")).toBeDefined();
      expect(screen.getAllByRole("button")).toHaveLength(5);
    });

    it("답하지 않은 질문(등급 null)은 등급을 비워 둔다", () => {
      renderQuestions({ items: UNANSWERED });

      expect(card(/트래픽 처리/).textContent).toBe("Q514:26대용량 트래픽 처리 방법은?");
    });

    it("질문을 펼치면 머리와 다른 카드를 빼고 그 카드 아래에 답변을 보여 준다", () => {
      renderQuestions({ opened: 2 });

      expect(screen.queryByRole("heading", { name: "질문" })).toBeNull();
      expect(screen.getAllByRole("button")).toHaveLength(1);
      const answerId = card(/기술적 문제는/).getAttribute("aria-controls") ?? "";
      expect(document.getElementById(answerId)?.textContent).toBe(
        "저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…",
      );
    });

    it("답하지 않은 질문을 펼치면 답변 칸에 '답변하지 않은 질문이에요'를 보여 준다", () => {
      renderQuestions({ items: UNANSWERED, opened: 4 });

      const answerId = card(/트래픽 처리/).getAttribute("aria-controls") ?? "";
      expect(document.getElementById(answerId)?.textContent).toBe("답변하지 않은 질문이에요");
    });
  });

  describe("사용자 조작", () => {
    it("접힌 카드를 누르면 그 순번으로 펼치기를 요청한다", () => {
      const { onToggle } = renderQuestions();

      fireEvent.click(card(/지원한 이유는/));

      expect(onToggle).toHaveBeenCalledWith(3);
    });

    it("동작 줄이기면 펼친 카드를 누를 때 바로 접기를 요청한다", () => {
      const { onToggle } = renderQuestions({ opened: 2 });

      fireEvent.click(card(/기술적 문제는/));

      expect(onToggle).toHaveBeenCalledWith(2);
      expect(motionState.shakes).toHaveLength(0);
    });
  });

  describe("상태 변화", () => {
    it("펼친 카드를 누르면 답변 칸을 접고 카드를 흔든 뒤에야 접기를 요청한다", async () => {
      motionState.reduce = false;
      const { onToggle } = renderQuestions({ opened: 2 });

      fireEvent.click(card(/기술적 문제는/));
      expect(screen.queryByText(/캐시 일관성 문제/)).toBeNull();
      expect(motionState.shakes).toHaveLength(1);
      expect(onToggle).not.toHaveBeenCalled();

      await act(async () => motionState.shakes[0]());

      expect(onToggle).toHaveBeenCalledWith(2);
    });
  });
});
