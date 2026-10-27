import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";

import { EndModal } from "./end-modal";
import { SAVE_WAIT_MS } from "./use-save-confirmed";

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
// · API 명세 5.8 「직전 답변 저장 확인」(화상: 제출됨을 받은 답변이 answeredCount에 보일 때까지 최대 10초 기다린 뒤 5.8,
//   기다리는 동안 저장 중 안내) · S15P31A301-257

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
    render(<EndModal sessionId={55} video answeredCount={2} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("답변한 질문 수와 스트릭 인정을 알리고, 안전한 [계속하기]에 포커스를 둔다", () => {
    render(<EndModal sessionId={55} video answeredCount={2} />);

    expect(dialog().textContent).toContain("지금 끝내면 답변한 2개 질문까지만결과가 나와요");
    expect(screen.getByText("오늘 스트릭은 인정돼요")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "계속하기" }));
  });

  it("답변이 0개면 '결과 없이 나가요 · 스트릭 미인정'으로 바꾸고 스트릭 인정 표시를 뺀다", () => {
    render(<EndModal sessionId={55} video answeredCount={0} />);

    expect(screen.getByText("결과 없이 나가요 · 스트릭 미인정")).toBeTruthy();
    expect(screen.queryByText("오늘 스트릭은 인정돼요")).toBeNull();
  });

  it("[계속하기] · Esc로 닫는다", () => {
    const { unmount } = render(<EndModal sessionId={55} video answeredCount={2} />);
    fireEvent.click(screen.getByRole("button", { name: "계속하기" }));
    expect(useInterviewStore.getState().endOpen).toBe(false);
    unmount();

    act(() => useInterviewStore.getState().openEnd());
    render(<EndModal sessionId={55} video answeredCount={2} />);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(useInterviewStore.getState().endOpen).toBe(false);
  });

  it("Tab · Shift+Tab은 모달 안에서만 돈다([끝내기] ↔ [계속하기])", () => {
    render(<EndModal sessionId={55} video answeredCount={2} />);
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
    render(<EndModal sessionId={55} video answeredCount={2} />);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "끝내기" })));

    expect(endSession).toHaveBeenCalledWith(55, expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(useInterviewStore.getState().endOpen).toBe(false);
  });

  it("끝내지 못하면 서버 문구를 보여 주고, 다시 누르면 같은 키로 보낸다", async () => {
    endSession.mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
    render(<EndModal sessionId={55} video answeredCount={2} />);
    const end = screen.getByRole("button", { name: "끝내기" });

    await act(async () => fireEvent.click(end));
    expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요.");
    await act(async () => fireEvent.click(end));

    expect(endSession.mock.calls[1][1]).toBe(endSession.mock.calls[0][1]);
  });

  it("키를 이미 썼다고 하면(keySpent) 다음에는 새 키로 보낸다", async () => {
    endSession.mockResolvedValue({ formError: "이미 처리된 요청이에요.", keySpent: true });
    render(<EndModal sessionId={55} video answeredCount={2} />);
    const end = screen.getByRole("button", { name: "끝내기" });

    await act(async () => fireEvent.click(end));
    await act(async () => fireEvent.click(end));

    expect(endSession.mock.calls[1][1]).not.toBe(endSession.mock.calls[0][1]);
  });

  it("끝내는 동안에는 두 버튼을 막고 Esc로 닫지 않으며, 끝나면 모달을 닫는다", async () => {
    // 응답을 테스트가 붙잡아 두었다가 마지막에 끝낸다. 끝나지 않는 작업을 남기면 다음 테스트의 화면 갱신이 막힌다.
    let finish!: (result: object) => void;
    endSession.mockReturnValue(new Promise((done) => (finish = done)));
    render(<EndModal sessionId={55} video answeredCount={2} />);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "끝내기" })));
    fireEvent.keyDown(dialog(), { key: "Escape" });

    expect(useInterviewStore.getState().endOpen).toBe(true);
    expect(screen.getByRole("button", { name: "계속하기" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "끝내기" })).toHaveProperty("disabled", true);

    await act(async () => finish({ leveledUp: true }));
    expect(useInterviewStore.getState()).toMatchObject({ endOpen: false, leveledUp: true });
  });
});

describe("EndModal · 직전 답변 저장 확인(API 명세 5.8)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    endSession.mockResolvedValue({ leveledUp: false });
  });
  afterEach(() => vi.useRealTimers());

  const endButton = () => screen.getByRole("button", { name: "끝내기" });

  it("제출됨을 받은 답변이 아직 저장되지 않았으면 [끝내기] 뒤 저장 중임을 알리고, 저장이 보이면 그때 5.8을 보낸다", async () => {
    // 에이전트가 3번 답변을 제출됨으로 알렸지만 5.2 answeredCount는 아직 2다
    useInterviewStore.getState().setSubmittedSeq(3);
    const { rerender } = render(<EndModal sessionId={55} video answeredCount={2} />);

    await act(async () => fireEvent.click(endButton()));
    expect(endSession).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("답변을 저장하는 중이에요");
    // 기다리는 동안은 두 버튼을 막고 Esc로 닫지 않는다
    expect(endButton()).toHaveProperty("disabled", true);
    expect(endButton().getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "계속하기" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(useInterviewStore.getState().endOpen).toBe(true);

    // 5.2를 다시 불러 저장된 것이 보이면 끝낸다
    rerender(<EndModal sessionId={55} video answeredCount={3} />);
    await act(async () => {});
    expect(endSession).toHaveBeenCalledExactlyOnceWith(
      55,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(useInterviewStore.getState().endOpen).toBe(false);
    // 남은 대기 시간이 지나도 다시 보내지 않는다
    await act(async () => vi.advanceTimersByTime(SAVE_WAIT_MS));
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it("10초가 지나도 저장이 보이지 않으면 그대로 5.8을 보내고, 그 뒤 저장이 보여도 다시 보내지 않는다", async () => {
    // 모달이 닫히지 않도록 실패로 답한다(닫히면 다시 그려도 보낼 수 없으므로 막이를 볼 수 없다)
    endSession.mockResolvedValue({ formError: "잠시 후 다시 시도해 주세요." });
    useInterviewStore.getState().setSubmittedSeq(3);
    const { rerender } = render(<EndModal sessionId={55} video answeredCount={2} />);
    await act(async () => fireEvent.click(endButton()));

    await act(async () => vi.advanceTimersByTime(SAVE_WAIT_MS - 1));
    expect(endSession).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(endSession).toHaveBeenCalledTimes(1);
    rerender(<EndModal sessionId={55} video answeredCount={3} />);
    await act(async () => {});
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it("마지막(5번째) 답변을 기다리는 중이면 저장 중임만 알리고 5.8은 보내지 않는다(자동 종료가 보낸다)", async () => {
    useInterviewStore.getState().setSubmittedSeq(5);
    render(<EndModal sessionId={55} video answeredCount={4} />);
    await act(async () => fireEvent.click(endButton()));
    expect(screen.getByRole("status").textContent).toBe("답변을 저장하는 중이에요");
    await act(async () => vi.advanceTimersByTime(SAVE_WAIT_MS));
    expect(endSession).not.toHaveBeenCalled();
  });

  it("답변 5개가 이미 저장된 것이 보이면(면접 화면이 끝내는 중) 5.8을 보내지 않고 화면이 넘어갈 때까지 저장 중으로 둔다", async () => {
    render(<EndModal sessionId={55} video answeredCount={5} />);
    await act(async () => fireEvent.click(endButton()));
    expect(screen.getByRole("status").textContent).toBe("답변을 저장하는 중이에요");
    expect(endButton()).toHaveProperty("disabled", true);
    await act(async () => vi.advanceTimersByTime(SAVE_WAIT_MS));
    expect(endSession).not.toHaveBeenCalled();
    expect(endButton()).toHaveProperty("disabled", true);
  });

  it("채팅은 답변 5개가 저장된 것이 보여도 기다리지 않고 바로 5.8을 보낸다(채팅의 마지막 5.8은 다시 보내지 않으므로)", async () => {
    render(<EndModal sessionId={55} answeredCount={5} video={false} />);
    await act(async () => fireEvent.click(endButton()));
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("기다리는 동안 면접 화면이 5.2를 계속 부르도록 알리고(confirmingSave), 끝나면 거둔다", async () => {
    useInterviewStore.getState().setSubmittedSeq(3);
    const { rerender } = render(<EndModal sessionId={55} video answeredCount={2} />);
    expect(useInterviewStore.getState().confirmingSave).toBe(false);
    await act(async () => fireEvent.click(endButton()));
    expect(useInterviewStore.getState().confirmingSave).toBe(true);
    rerender(<EndModal sessionId={55} video answeredCount={3} />);
    await act(async () => {});
    expect(useInterviewStore.getState().confirmingSave).toBe(false);
  });

  it("이미 저장된 것이 보이거나 제출됨을 받은 답변이 없으면(채팅 포함) 기다리지 않고 바로 5.8을 보낸다", async () => {
    useInterviewStore.getState().setSubmittedSeq(3);
    const { unmount } = render(<EndModal sessionId={55} video answeredCount={3} />);
    await act(async () => fireEvent.click(endButton()));
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
    unmount();

    endSession.mockClear();
    useInterviewStore.getState().reset();
    useInterviewStore.getState().openEnd();
    render(<EndModal sessionId={55} video={false} answeredCount={2} />);
    await act(async () => fireEvent.click(endButton()));
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it("기다린 뒤 보낸 5.8이 실패하면 문구를 보이고, [끝내기]를 다시 누르면 기다리지 않고 바로 다시 보낸다", async () => {
    endSession.mockResolvedValueOnce({ formError: "잠시 후 다시 시도해 주세요." });
    useInterviewStore.getState().setSubmittedSeq(3);
    render(<EndModal sessionId={55} video answeredCount={2} />);
    endButton().focus();
    await act(async () => fireEvent.click(endButton()));
    await act(async () => vi.advanceTimersByTime(SAVE_WAIT_MS));
    expect(screen.getByRole("alert").textContent).toBe("잠시 후 다시 시도해 주세요.");

    // 다시 누를 수 있게 되면 포커스가 모달 안([계속하기])으로 돌아와 Esc · Tab이 듣는다
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "계속하기" }));

    await act(async () => fireEvent.click(endButton()));
    expect(endSession).toHaveBeenCalledTimes(2);
  });
});
