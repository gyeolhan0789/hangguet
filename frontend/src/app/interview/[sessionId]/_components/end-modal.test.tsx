import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";

import { EndModal } from "./end-modal";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// 서버 액션 경계만 바꾼다. 실제 5.8 요청 · S06-1 전환은 E2E(interview.spec.ts)가 본다.
const endSession = vi.fn();
vi.mock("@/lib/interview/actions", () => ({
  endSession: (...args: unknown[]) => endSession(...args),
}));

// 기준: Figma S06-E(18:4226) · 기획 메모 S06-E(18:3508: 안전한 쪽(계속하기) 강조, 답변 0개면 '결과 없이 나가요' + 스트릭 미인정)
// · 모션 메모 S06-E(18:4318) · WAI-ARIA APG 대화상자 패턴(안에서만 Tab, Esc로 닫힘)

beforeEach(() => {
  useInterviewStore.getState().reset();
  useInterviewStore.getState().openEnd();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const dialog = () => screen.getByRole("dialog", { name: "면접을 끝낼까요?" });

describe("EndModal (S06-E 면접 종료 확인)", () => {
  it("[면접 종료]로 열리기 전에는 그리지 않는다", () => {
    useInterviewStore.getState().closeEnd();
    render(<EndModal sessionId={55} answeredCount={2} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("답변한 질문 수와 스트릭 인정을 알리고, 안전한 [계속하기]에 포커스를 둔다", () => {
    render(<EndModal sessionId={55} answeredCount={2} />);

    expect(dialog().textContent).toContain("지금 끝내면 답변한 2개 질문까지만결과가 나와요");
    expect(screen.getByText("오늘 스트릭은 인정돼요")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "계속하기" }));
  });

  it("답변이 0개면 '결과 없이 나가요 · 스트릭 미인정'으로 바꾸고 스트릭 인정 표시를 뺀다", () => {
    render(<EndModal sessionId={55} answeredCount={0} />);

    expect(screen.getByText("결과 없이 나가요 · 스트릭 미인정")).toBeTruthy();
    expect(screen.queryByText("오늘 스트릭은 인정돼요")).toBeNull();
  });

  it("[계속하기] · Esc로 닫는다", () => {
    const { unmount } = render(<EndModal sessionId={55} answeredCount={2} />);
    fireEvent.click(screen.getByRole("button", { name: "계속하기" }));
    expect(useInterviewStore.getState().endOpen).toBe(false);
    unmount();

    act(() => useInterviewStore.getState().openEnd());
    render(<EndModal sessionId={55} answeredCount={2} />);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(useInterviewStore.getState().endOpen).toBe(false);
  });

  it("Tab · Shift+Tab은 모달 안에서만 돈다([끝내기] ↔ [계속하기])", () => {
    render(<EndModal sessionId={55} answeredCount={2} />);
    const end = screen.getByRole("button", { name: "끝내기" });
    const keep = screen.getByRole("button", { name: "계속하기" });

    keep.focus();
    fireEvent.keyDown(dialog(), { key: "Tab" });
    expect(document.activeElement).toBe(end);
    fireEvent.keyDown(dialog(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(keep);
  });

  it("[끝내기]는 5.8을 UUID 멱등 키로 부르고, 끝나면 모달을 닫는다", async () => {
    endSession.mockResolvedValue({});
    render(<EndModal sessionId={55} answeredCount={2} />);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "끝내기" })));

    expect(endSession).toHaveBeenCalledWith(55, expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(useInterviewStore.getState().endOpen).toBe(false);
  });

  it("끝내지 못하면 서버 문구를 보여 주고, 다시 누르면 같은 키로 보낸다", async () => {
    endSession.mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
    render(<EndModal sessionId={55} answeredCount={2} />);
    const end = screen.getByRole("button", { name: "끝내기" });

    await act(async () => fireEvent.click(end));
    expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요.");
    await act(async () => fireEvent.click(end));

    expect(endSession.mock.calls[1][1]).toBe(endSession.mock.calls[0][1]);
  });

  it("키를 이미 썼다고 하면(keyReused) 다음에는 새 키로 보낸다", async () => {
    endSession.mockResolvedValue({ formError: "이미 처리된 요청이에요.", keyReused: true });
    render(<EndModal sessionId={55} answeredCount={2} />);
    const end = screen.getByRole("button", { name: "끝내기" });

    await act(async () => fireEvent.click(end));
    await act(async () => fireEvent.click(end));

    expect(endSession.mock.calls[1][1]).not.toBe(endSession.mock.calls[0][1]);
  });

  it("끝내는 동안에는 두 버튼을 막고 Esc로 닫지 않으며, 끝나면 모달을 닫는다", async () => {
    // 응답을 테스트가 붙잡아 두었다가 마지막에 끝낸다. 끝나지 않는 작업을 남기면 다음 테스트의 화면 갱신이 막힌다.
    let finish!: (result: object) => void;
    endSession.mockReturnValue(new Promise((done) => (finish = done)));
    render(<EndModal sessionId={55} answeredCount={2} />);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "끝내기" })));
    fireEvent.keyDown(dialog(), { key: "Escape" });

    expect(useInterviewStore.getState().endOpen).toBe(true);
    expect(screen.getByRole("button", { name: "계속하기" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "끝내기" })).toHaveProperty("disabled", true);

    await act(async () => finish({ leveledUp: true }));
    expect(useInterviewStore.getState()).toMatchObject({ endOpen: false, leveledUp: true });
  });
});
