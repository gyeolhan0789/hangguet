import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewHistoryStore } from "@/stores/interview-history-store";
import { useInterviewStore } from "@/stores/interview-store";

import { InterviewHistory } from "./interview-history";

// jsdom에는 애니메이션 프레임이 없어 사라지는 애니메이션이 끝나지 않는다. 나타남 · 사라짐만 보도록 바로 빼게 한다.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

// 기준: 사용자 요청(2026-10-27: 면접 중 지난 질문 · 답변 히스토리, 접기는 질문 말풍선의 꺾쇠 하나로)

beforeEach(() => {
  useInterviewHistoryStore.setState({ sessionId: null, items: [] });
  useInterviewStore.getState().reset();
});
afterEach(cleanup);

const add = (sessionId: number, seq: number, answer = `답변 ${seq}`) =>
  act(() =>
    useInterviewHistoryStore.getState().add(sessionId, { seq, question: `질문 ${seq}`, answer }),
  );

describe("useInterviewHistoryStore", () => {
  it("질문 순서대로 쌓고, 같은 질문을 다시 내면 마지막 답변으로 바꾼다", () => {
    add(55, 2);
    add(55, 1);
    add(55, 2, "다시 낸 답변");
    expect(useInterviewHistoryStore.getState().items).toEqual([
      { seq: 1, question: "질문 1", answer: "답변 1" },
      { seq: 2, question: "질문 2", answer: "다시 낸 답변" },
    ]);
  });

  it("같은 질문을 답변 글 없이 다시 내면(새로고침 뒤 자막 없이 [다시 시도]) 있던 답변 글을 둔다", () => {
    add(55, 1, "처음 낸 답변");
    add(55, 1, "");
    expect(useInterviewHistoryStore.getState().items).toEqual([
      { seq: 1, question: "질문 1", answer: "처음 낸 답변" },
    ]);
  });

  it("다른 면접에 들어오거나(enter) 다른 면접의 답변이 오면 지난 면접 히스토리를 비운다", () => {
    add(55, 1);
    act(() => useInterviewHistoryStore.getState().enter(55));
    expect(useInterviewHistoryStore.getState().items).toHaveLength(1);

    act(() => useInterviewHistoryStore.getState().enter(77));
    expect(useInterviewHistoryStore.getState()).toEqual(
      expect.objectContaining({ sessionId: 77, items: [] }),
    );

    add(55, 1);
    add(88, 3);
    expect(useInterviewHistoryStore.getState()).toEqual(
      expect.objectContaining({
        sessionId: 88,
        items: [{ seq: 3, question: "질문 3", answer: "답변 3" }],
      }),
    );
  });
});

describe("InterviewHistory", () => {
  it("답한 질문이 없거나 다른 면접의 히스토리면 그리지 않는다", () => {
    const { container, rerender } = render(<InterviewHistory sessionId={55} />);
    expect(container.innerHTML).toBe("");
    add(77, 1);
    rerender(<InterviewHistory sessionId={55} />);
    expect(container.innerHTML).toBe("");
  });

  it("이전 질문과 내 답변을 대화처럼 보이고(답변 글이 없으면 질문만), 질문 말풍선을 접으면 숨는다", () => {
    add(55, 1);
    add(55, 2, "");
    render(<InterviewHistory sessionId={55} />);
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual(["Q1질문 1답변 1", "Q2질문 2"]);
    // 따로 여닫는 버튼은 없다(접기는 질문 말풍선의 꺾쇠 하나)
    expect(screen.queryByRole("button")).toBeNull();

    act(() => useInterviewStore.getState().toggleCollapsed());
    expect(screen.queryByRole("list", { name: "이전 질문과 내 답변" })).toBeNull();
    act(() => useInterviewStore.getState().toggleCollapsed());
    expect(screen.getByRole("list", { name: "이전 질문과 내 답변" })).toBeTruthy();
  });
});
