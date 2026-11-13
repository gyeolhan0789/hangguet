// 기준: Figma S06-E 면접 종료 확인(18:4226) · API 명세 10.10(그룹 5.8은 답변 저장을 기다리지 않는다) · 기획 메모 S06-E(18:3508: 안전한 쪽(계속하기) 강조, 답변 0개면 '결과 없이 나가요' + 스트릭 미인정) · 웹 Swagger 5.8 면접 끝내기 · API 명세 5.8 「직전 답변 저장 확인」 · S15P31A301-257
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { endSession, type SessionActionResult } from "@/lib/interview/actions";
import { gazeRatio, type GazeFrame, type GazeSample } from "@/lib/interview/gaze";
import { useGazeStore } from "@/stores/gaze-store";
import { useInterviewStore } from "@/stores/interview-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { EndModal } from "./end-modal";

// 경계 mock: 서버 액션(5.8)과 연출(motion). 시선 비율 계산 · store는 진짜로 쓴다
vi.mock("@/lib/interview/actions", () => ({ endSession: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: 정면을 본 시선 프레임과 얼굴이 잡히지 않은 프레임(면접 동안 잰 값)
const FRONT: GazeSample = { headYaw: 0, headPitch: 0, eyeYaw: 0, eyePitch: 0, blinking: false };
const LOOKED: GazeFrame[] = Array.from({ length: 100 }, () => FRONT);
const MISSED: GazeFrame[] = Array.from({ length: 100 }, () => null);
const FAILED: SessionActionResult = { formError: "잠시 후 다시 시도해 주세요." };

const dialog = () => screen.getByRole("dialog", { name: "면접을 끝낼까요?" });
const endButton = () => screen.getByRole("button", { name: "끝내기" });
const keepButton = () => screen.getByRole("button", { name: "계속하기" });
const savingNotice = () => screen.queryByText("답변을 저장하는 중이에요");
/** n번째 endSession 호출의 [멱등 키, 시선 비율] */
const sent = (n: number) => vi.mocked(endSession).mock.calls[n].slice(1);

async function clickEnd() {
  fireEvent.click(endButton());
  await flushPromises();
}

beforeEach(() => {
  useGazeStore.getState().reset();
  useInterviewStore.getState().reset();
  useInterviewStore.getState().openEnd();
  vi.mocked(endSession).mockResolvedValue({ leveledUp: false });
});

describe("EndModal · 면접 종료 확인 모달", () => {
  describe("종료 확인", () => {
    describe("화면 표시", () => {
      it("열리기 전에는 그리지 않는다", () => {
        useInterviewStore.getState().closeEnd();

        render(<EndModal sessionId={55} answeredCount={2} video />);

        expect(screen.queryByRole("dialog")).toBeNull();
      });

      it("답변이 있으면 답변한 질문 수와 스트릭 인정을 알린다", () => {
        render(<EndModal sessionId={55} answeredCount={2} video />);

        expect(dialog().textContent).toContain("지금 끝내면 답변한 2개 질문까지만결과가 나와요");
        expect(screen.getByText("오늘 스트릭은 인정돼요")).toBeDefined();
      });

      it("열리면 [계속하기]에 포커스를 둔다", () => {
        render(<EndModal sessionId={55} answeredCount={2} video />);

        expect(document.activeElement).toBe(keepButton());
      });
    });

    describe("사용자 조작", () => {
      it("[계속하기]를 누르면 닫는다", () => {
        render(<EndModal sessionId={55} answeredCount={2} video />);

        fireEvent.click(keepButton());

        expect(useInterviewStore.getState().endOpen).toBe(false);
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      it("Esc를 누르면 닫는다", () => {
        render(<EndModal sessionId={55} answeredCount={2} video />);

        fireEvent.keyDown(dialog(), { key: "Escape" });

        expect(useInterviewStore.getState().endOpen).toBe(false);
      });

      it("마지막 버튼에서 Tab을 누르면 모달 안 첫 버튼으로 돌아간다", () => {
        render(<EndModal sessionId={55} answeredCount={2} video />);

        fireEvent.keyDown(dialog(), { key: "Tab" });

        expect(document.activeElement).toBe(endButton());
      });

      it("끝내기가 성공하면 레벨업을 기억하고 모달을 닫는다", async () => {
        vi.mocked(endSession).mockResolvedValue({ leveledUp: true });
        render(<EndModal sessionId={55} answeredCount={2} video />);

        await clickEnd();

        expect(useInterviewStore.getState()).toMatchObject({ leveledUp: true, endOpen: false });
      });

      it("화상이면 면접 동안 잰 시선 비율을 보낸다", async () => {
        const frames = [...LOOKED, ...MISSED];
        useGazeStore.setState({ frames });
        render(<EndModal sessionId={55} answeredCount={2} video />);

        await clickEnd();

        expect(sent(0)[1]).toBe(gazeRatio(frames));
      });

      it("채팅이면 시선 비율을 보내지 않는다", async () => {
        useGazeStore.setState({ frames: LOOKED });
        render(<EndModal sessionId={55} answeredCount={2} video={false} />);

        await clickEnd();

        expect(sent(0)[1]).toBeNull();
      });
    });

    describe("경계값", () => {
      it("답변이 0개면 '결과 없이 나가요 · 스트릭 미인정'으로 바꾸고 스트릭 인정을 뺀다", () => {
        render(<EndModal sessionId={55} answeredCount={0} video />);

        expect(screen.getByText("결과 없이 나가요 · 스트릭 미인정")).toBeDefined();
        expect(screen.queryByText("오늘 스트릭은 인정돼요")).toBeNull();
      });
    });

    describe("오류 처리", () => {
      it("끝내기가 실패하면 서버 문구를 보이고 모달을 그대로 둔다", async () => {
        // 예시: Swagger 5.8 409 INVALID_SESSION_STATE detail(대체 문구와 다르게)
        vi.mocked(endSession).mockResolvedValue({ formError: "지금은 할 수 없는 요청이에요." });
        render(<EndModal sessionId={55} answeredCount={2} video />);

        await clickEnd();

        expect(screen.getByRole("alert").textContent).toBe("지금은 할 수 없는 요청이에요.");
        expect(useInterviewStore.getState().endOpen).toBe(true);
      });

      it("실패 뒤 다시 누르면 같은 멱등 키와 처음 시선 비율로 보낸다", async () => {
        vi.mocked(endSession).mockResolvedValue(FAILED);
        useGazeStore.setState({ frames: LOOKED });
        render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();

        useGazeStore.setState({ frames: [...LOOKED, ...MISSED] });
        await clickEnd();

        expect(sent(1)).toEqual(sent(0));
        expect(sent(1)[1]).toBe(gazeRatio(LOOKED));
      });

      it("서버가 실패로 답했으면(keySpent) 다음에는 새 키와 그때까지 잰 시선 비율로 보낸다", async () => {
        vi.mocked(endSession).mockResolvedValue({ ...FAILED, keySpent: true });
        useGazeStore.setState({ frames: LOOKED });
        render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();

        const frames = [...LOOKED, ...MISSED];
        useGazeStore.setState({ frames });
        await clickEnd();

        expect(sent(1)[0]).not.toBe(sent(0)[0]);
        expect(sent(1)[1]).toBe(gazeRatio(frames));
      });

      it("닫았다 다시 열면 실패 문구를 지운다", async () => {
        vi.mocked(endSession).mockResolvedValue(FAILED);
        render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();

        fireEvent.click(keepButton());
        act(() => useInterviewStore.getState().openEnd());

        expect(screen.queryByRole("alert")).toBeNull();
      });

      it("다시 누르면 이전 실패 문구를 지운다", async () => {
        const response = deferred<SessionActionResult>();
        vi.mocked(endSession).mockResolvedValueOnce(FAILED).mockReturnValueOnce(response.promise);
        render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();

        await clickEnd();

        expect(screen.queryByRole("alert")).toBeNull();
        await act(async () => response.resolve({ leveledUp: false }));
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("끝내는 동안 두 버튼을 막고 Esc로 닫지 않는다", async () => {
        const response = deferred<SessionActionResult>();
        vi.mocked(endSession).mockReturnValue(response.promise);
        render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();

        fireEvent.keyDown(dialog(), { key: "Escape" });

        expect(endButton()).toHaveProperty("disabled", true);
        expect(keepButton()).toHaveProperty("disabled", true);
        expect(useInterviewStore.getState().endOpen).toBe(true);
        await act(async () => response.resolve({ leveledUp: false }));
      });

      it("끝내기가 실패해 다시 누를 수 있게 되면 [계속하기]에 포커스를 되돌린다", async () => {
        const response = deferred<SessionActionResult>();
        vi.mocked(endSession).mockReturnValue(response.promise);
        render(<EndModal sessionId={55} answeredCount={2} video />);
        endButton().focus();
        await clickEnd();

        await act(async () => response.resolve(FAILED));

        expect(document.activeElement).toBe(keepButton());
      });
    });
  });

  describe("직전 답변 저장 확인", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    describe("화면 표시", () => {
      it("제출된 답변이 아직 저장되지 않았으면 [끝내기] 뒤 '답변을 저장하는 중이에요'를 알리고 바로 보내지 않는다", async () => {
        useInterviewStore.getState().setSubmittedSeq(3);
        render(<EndModal sessionId={55} answeredCount={2} video />);

        await clickEnd();

        expect(savingNotice()).not.toBeNull();
        expect(endSession).not.toHaveBeenCalled();
      });
    });

    describe("사용자 조작", () => {
      it.each([
        { label: "제출된 답변이 아직 저장되지 않음", submittedSeq: 3, answeredCount: 2 },
        { label: "화상 답변 5개", submittedSeq: 5, answeredCount: 5 },
      ])(
        "그룹 면접(API 명세 10.10: 5.8은 저장을 기다릴 필요가 없다)이면 '$label'이어도 바로 끝내기를 요청한다",
        async ({ submittedSeq, answeredCount }) => {
          useInterviewStore.getState().setSubmittedSeq(submittedSeq);
          render(<EndModal sessionId={55} answeredCount={answeredCount} video group />);

          await clickEnd();

          expect(endSession).toHaveBeenCalledTimes(1);
          expect(savingNotice()).toBeNull();
        },
      );

      it.each([
        { label: "이미 저장됨", submittedSeq: 3, answeredCount: 3 },
        { label: "제출된 답변 없음", submittedSeq: null, answeredCount: 2 },
      ])(
        "'$label'이면 기다리지 않고 바로 끝내기를 요청한다",
        async ({ submittedSeq, answeredCount }) => {
          useInterviewStore.getState().setSubmittedSeq(submittedSeq);
          render(<EndModal sessionId={55} answeredCount={answeredCount} video />);

          await clickEnd();

          expect(endSession).toHaveBeenCalledTimes(1);
          expect(savingNotice()).toBeNull();
        },
      );
    });

    describe("상태 변화", () => {
      it("기다리는 중에 저장이 보이면 그때 끝내기를 요청한다", async () => {
        useInterviewStore.getState().setSubmittedSeq(3);
        const { rerender } = render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();

        rerender(<EndModal sessionId={55} answeredCount={3} video />);
        await flushPromises();

        expect(endSession).toHaveBeenCalledTimes(1);
      });

      it("기다린 뒤 실패하고 닫았다 다시 열어 [끝내기]하면 다시 저장을 기다린다", async () => {
        vi.mocked(endSession).mockResolvedValue(FAILED);
        useInterviewStore.getState().setSubmittedSeq(3);
        render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();
        await act(async () => vi.advanceTimersByTime(10_000));
        fireEvent.click(keepButton());
        act(() => useInterviewStore.getState().openEnd());

        await clickEnd();
        expect(savingNotice()).not.toBeNull();
        expect(endSession).toHaveBeenCalledTimes(1);

        await act(async () => vi.advanceTimersByTime(10_000));
        expect(endSession).toHaveBeenCalledTimes(2);
      });

      it("기다리는 동안 저장 확인 중을 켜고, 끝나면 끈다", async () => {
        useInterviewStore.getState().setSubmittedSeq(3);
        const { rerender } = render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();
        expect(useInterviewStore.getState().confirmingSave).toBe(true);

        rerender(<EndModal sessionId={55} answeredCount={3} video />);
        await flushPromises();

        expect(useInterviewStore.getState().confirmingSave).toBe(false);
      });
    });

    describe("경계값", () => {
      it("화상 마지막(5번째) 답변이 제출됐으면 저장 중만 알리고 끝내기를 보내지 않는다", async () => {
        useInterviewStore.getState().setSubmittedSeq(5);
        render(<EndModal sessionId={55} answeredCount={4} video />);
        await clickEnd();

        await act(async () => vi.advanceTimersByTime(10_000));

        expect(savingNotice()).not.toBeNull();
        expect(endSession).not.toHaveBeenCalled();
      });

      it("화상 답변 5개가 저장된 것이 보이면 끝내기를 보내지 않고 저장 중으로 둔다", async () => {
        render(<EndModal sessionId={55} answeredCount={5} video />);
        await clickEnd();

        await act(async () => vi.advanceTimersByTime(10_000));

        expect(savingNotice()).not.toBeNull();
        expect(endButton()).toHaveProperty("disabled", true);
        expect(endSession).not.toHaveBeenCalled();
      });

      it("채팅은 답변 5개가 저장돼도 기다리지 않고 바로 끝내기를 요청한다", async () => {
        render(<EndModal sessionId={55} answeredCount={5} video={false} />);

        await clickEnd();

        expect(endSession).toHaveBeenCalledTimes(1);
        expect(savingNotice()).toBeNull();
      });
    });

    describe("오류 처리", () => {
      it("기다린 뒤 보낸 끝내기가 실패하면 다시 누를 때 기다리지 않고 바로 보낸다", async () => {
        vi.mocked(endSession).mockResolvedValue(FAILED);
        useInterviewStore.getState().setSubmittedSeq(3);
        render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();
        await act(async () => vi.advanceTimersByTime(10_000));

        await clickEnd();

        expect(endSession).toHaveBeenCalledTimes(2);
      });
    });

    describe("시간 경과", () => {
      it("10초가 지나도 저장이 보이지 않으면 그대로 끝내기를 요청한다", async () => {
        useInterviewStore.getState().setSubmittedSeq(3);
        render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();

        await act(async () => vi.advanceTimersByTime(9_999));
        expect(endSession).not.toHaveBeenCalled();

        await act(async () => vi.advanceTimersByTime(1));
        expect(endSession).toHaveBeenCalledTimes(1);
      });
    });

    describe("정리", () => {
      it("모달이 사라지면 저장 확인 중을 끈다", async () => {
        useInterviewStore.getState().setSubmittedSeq(3);
        const { unmount } = render(<EndModal sessionId={55} answeredCount={2} video />);
        await clickEnd();

        unmount();

        expect(useInterviewStore.getState().confirmingSave).toBe(false);
      });
    });
  });
});
