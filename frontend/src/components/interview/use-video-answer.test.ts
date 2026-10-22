import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnswerSttStatus } from "./use-answer-stt";
import { useVideoAnswer } from "./use-video-answer";

// 기준: API 명세 5.6 · 5.7(자동 제출 7초 · 60초, 빈 답변 미전송, 같은 키 재전송, 화상 content 1~10,000자) · 화상 답변 시작 · 제출 순서
// 음성 인식 훅 · 답변 녹음 · 서버 액션 · 제출 함수를 테스트 대역으로 대체하고 훅이 호출하는 순서만 확인한다.

const calls: string[] = [];

const stt = {
  status: "idle" as AnswerSttStatus,
  caption: "",
  answer: { content: "조회 응답 시간을 40% 줄였습니다.", tokens: null as null },
  onSpeech: undefined as ((at: number) => void) | undefined,
  onSentence: undefined as ((sentence: { text: string; pauseMs: number }) => void) | undefined,
  start: vi.fn(() => calls.push("stt.start")),
  reconnect: vi.fn(() => calls.push("stt.reconnect")),
  stop: vi.fn(async () => {
    calls.push("stt.stop");
  }),
  cancel: vi.fn(() => calls.push("stt.cancel")),
};
vi.mock("./use-answer-stt", () => ({
  useAnswerStt: (options: {
    onSpeech?: (at: number) => void;
    onSentence?: (sentence: { text: string; pauseMs: number }) => void;
  }) => {
    stt.onSpeech = options.onSpeech;
    stt.onSentence = options.onSentence;
    return {
      status: stt.status,
      caption: stt.caption,
      start: stt.start,
      reconnect: stt.reconnect,
      stop: stt.stop,
      cancel: stt.cancel,
      getAnswer: () => stt.answer,
    };
  },
}));

const capture = {
  start: vi.fn(async () => {
    calls.push("capture.start");
    return { ok: true, fileStartedAt: 100, contentType: "audio/webm" } as const;
  }),
  stopFile: vi.fn(async () => {
    calls.push("capture.stopFile");
    return new Blob(["webm"]) as Blob | null;
  }),
  dispose: vi.fn(() => calls.push("capture.dispose")),
  createSttSource: vi.fn(),
  getSttStartedAt: vi.fn(),
};
vi.mock("@/lib/stt/answer-capture", () => ({ createAnswerCapture: () => capture }));

const createAnswerAudioUploadUrl = vi.fn(async () => {
  calls.push("5.6");
  return {
    ok: true,
    uploadUrl: "https://s3.example/put",
    objectKey: "sessions/55/answers/303.webm",
    expiresAt: "2026-10-15T12:16:12+09:00",
  } as const;
});
const sendReaction = vi.fn(async (_s: number, _q: number, request: { seq: number }) => ({
  ok: true as const,
  seq: request.seq,
  reaction: null,
  attitude: { interest: 0.5, trust: 0.5, tension: 0.5 },
  interrupt: null,
}));
vi.mock("@/lib/interview/actions", () => ({
  sendReaction: (...args: Parameters<typeof sendReaction>) => sendReaction(...args),
  createAnswerAudioUploadUrl: (...args: unknown[]) =>
    (createAnswerAudioUploadUrl as (...a: unknown[]) => unknown)(...args),
}));

type Outcome =
  | { kind: "accepted"; isLastQuestion: boolean }
  | { kind: "alreadySubmitted" }
  | { kind: "failed"; next: unknown; failure: unknown };
const submitPreparedAnswer = vi.fn<(prepared: unknown) => Promise<Outcome>>(async () => {
  calls.push("submit");
  return { kind: "accepted", isLastQuestion: false };
});
vi.mock("@/lib/interview/answer-submission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/interview/answer-submission")>()),
  submitPreparedAnswer: (prepared: unknown) => submitPreparedAnswer(prepared),
}));

let now = 0;
const onSubmitted = vi.fn();
const onReaction = vi.fn();

function render(questionId = 303) {
  return renderHook(
    ({ id }) =>
      useVideoAnswer({
        sessionId: 55,
        questionId: id,
        questionText: "질문",
        onSubmitted,
        onReaction,
      }),
    { initialProps: { id: questionId } },
  );
}

async function started() {
  const hook = render();
  await act(async () => {
    await hook.result.current.start();
  });
  return hook;
}

/** 시간을 ms만큼 경과시키고 7초 · 60초 확인을 실행한다 */
async function advance(ms: number) {
  now += ms;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  calls.length = 0;
  stt.status = "idle";
  stt.answer = { content: "조회 응답 시간을 40% 줄였습니다.", tokens: null };
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useVideoAnswer 답변 시작", () => {
  it("답변 녹음 → 5.6 → 음성 인식 순서로 시작하고 listening이 된다", async () => {
    const hook = await started();

    expect(calls).toEqual(["capture.start", "5.6", "stt.start"]);
    expect(createAnswerAudioUploadUrl).toHaveBeenCalledWith(55, 303, "audio/webm");
    expect(stt.start).toHaveBeenCalledWith({
      capture,
      fileStartedAt: 100,
      questionText: "질문",
    });
    expect(hook.result.current.phase).toBe("listening");
  });

  it("[답변 시작]을 두 번 눌러도 마이크 · 5.6은 한 번만 호출한다(시작 중 잠금)", async () => {
    const hook = render();
    await act(async () => {
      await Promise.all([hook.result.current.start(), hook.result.current.start()]);
    });

    expect(capture.start).toHaveBeenCalledTimes(1);
    expect(createAnswerAudioUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("마이크를 열지 못하면 녹음을 해제하고 답변 전으로 돌아가고 이유를 기록한다", async () => {
    capture.start.mockImplementationOnce(async () => {
      calls.push("capture.start");
      return { ok: false, reason: "denied" } as never;
    });

    const hook = await started();

    expect(calls).toEqual(["capture.start", "capture.dispose"]);
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.startFailure).toEqual({ kind: "device", reason: "denied" });
  });

  it("5.6이 실패하면 녹음을 해제하고 답변 전으로 돌아간다", async () => {
    createAnswerAudioUploadUrl.mockImplementationOnce(async () => {
      calls.push("5.6");
      return {
        ok: false,
        code: "INVALID_SESSION_STATE",
        status: 409,
      } as never;
    });

    const hook = await started();

    expect(calls).toEqual(["capture.start", "5.6", "capture.dispose"]);
    expect(stt.start).not.toHaveBeenCalled();
    expect(hook.result.current.startFailure).toMatchObject({ kind: "uploadUrl" });
  });
});

describe("useVideoAnswer 제출", () => {
  it("음성 인식 stop → 파일 stop → 제출 순서이고, 접수되면 녹음을 해제하고 결과를 전달한다", async () => {
    const hook = await started();
    calls.length = 0;

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(calls).toEqual(["stt.stop", "capture.stopFile", "submit", "capture.dispose"]);
    expect(submitPreparedAnswer.mock.calls[0][0]).toMatchObject({
      sessionId: 55,
      questionId: 303,
      body: {
        content: "조회 응답 시간을 40% 줄였습니다.",
        audioObjectKey: "sessions/55/answers/303.webm",
        tokens: null,
      },
      upload: { contentType: "audio/webm", expiresAt: "2026-10-15T12:16:12+09:00" },
    });
    expect(hook.result.current.phase).toBe("submitted");
    expect(onSubmitted).toHaveBeenCalledWith({ kind: "accepted", isLastQuestion: false });
  });

  it("답변 글이 비면 5.7을 제출하지 않고 다시 듣는다(파일 녹음은 유지한다)", async () => {
    const hook = await started();
    stt.answer = { content: "", tokens: null };
    calls.length = 0;

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(calls).toEqual(["stt.stop", "stt.start"]);
    expect(hook.result.current.phase).toBe("listening");
  });

  it("답변 글이 10,000자면 제출한다", async () => {
    const hook = await started();
    stt.answer = { content: "가".repeat(10_000), tokens: null };

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(submitPreparedAnswer).toHaveBeenCalledTimes(1);
    expect(hook.result.current.phase).toBe("submitted");
  });

  it("답변 글이 10,000자를 초과하면 5.7 없이 답변 전으로 돌아가고 VALIDATION_FAILED를 기록한다", async () => {
    const hook = await started();
    stt.answer = { content: "가".repeat(10_001), tokens: null };
    calls.length = 0;

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(calls).toEqual(["stt.stop", "capture.dispose"]);
    expect(submitPreparedAnswer).not.toHaveBeenCalled();
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.submitFailure).toEqual({
      ok: false,
      code: "VALIDATION_FAILED",
      status: 400,
    });

    await act(async () => {
      await hook.result.current.start();
    });
    expect(hook.result.current.phase).toBe("listening");
    expect(hook.result.current.submitFailure).toBeNull();
  });

  it("제출 중에 다시 눌러도 한 번만 제출한다", async () => {
    const hook = await started();

    await act(async () => {
      await Promise.all([hook.result.current.submit(), hook.result.current.submit()]);
    });

    expect(submitPreparedAnswer).toHaveBeenCalledTimes(1);
  });

  it("제출이 실패하면 submitFailed이고 [다시 시도]는 반환받은 같은 제출 데이터로 다시 전송한다", async () => {
    const next = { marker: "same-key-same-body" };
    submitPreparedAnswer.mockResolvedValueOnce({
      kind: "failed",
      next,
      failure: { ok: false, code: null, status: 502 },
    });
    const hook = await started();

    await act(async () => {
      await hook.result.current.submit();
    });
    expect(hook.result.current.phase).toBe("submitFailed");
    expect(hook.result.current.submitFailure).toEqual({ ok: false, code: null, status: 502 });

    await act(async () => {
      await hook.result.current.retry();
    });

    expect(submitPreparedAnswer).toHaveBeenLastCalledWith(next);
    expect(hook.result.current.phase).toBe("submitted");
  });

  it("음성 인식 오류 상태에서도 [답변 완료]로 제출할 수 있다", async () => {
    const hook = await started();
    stt.status = "error";
    hook.rerender({ id: 303 });

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(submitPreparedAnswer).toHaveBeenCalledTimes(1);
  });

  it("파일 녹음기가 중지되어 음성이 없으면 제출하지 않고 답변 전으로 되돌린다", async () => {
    capture.stopFile.mockResolvedValueOnce(null);
    const hook = await started();

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(submitPreparedAnswer).not.toHaveBeenCalled();
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.startFailure).toEqual({ kind: "device", reason: "ended" });
  });
});

describe("useVideoAnswer 자동 제출 · 60초", () => {
  it("발화한 뒤 7초 동안 발화가 없으면 자동 제출한다", async () => {
    await started();
    act(() => stt.onSpeech?.(now));

    await advance(6_900);
    expect(submitPreparedAnswer).not.toHaveBeenCalled();
    await advance(200);

    expect(submitPreparedAnswer).toHaveBeenCalledTimes(1);
  });

  it("발화를 시작하지 않은 채 60초가 경과하면 음성 인식과 파일을 폐기하고 timedOut이 된다", async () => {
    const hook = await started();
    calls.length = 0;

    await advance(60_000);

    expect(calls).toEqual(["stt.cancel", "capture.dispose"]);
    expect(hook.result.current.phase).toBe("timedOut");
    expect(submitPreparedAnswer).not.toHaveBeenCalled();
  });

  it("60초 종료 뒤 [다시 시작]은 같은 답변 시작을 처음부터 다시 수행한다", async () => {
    const hook = await started();
    await advance(60_000);
    calls.length = 0;

    await act(async () => {
      await hook.result.current.start();
    });

    expect(calls).toEqual(["capture.start", "5.6", "stt.start"]);
    expect(hook.result.current.phase).toBe("listening");
  });

  it("SDK 자동 재연결 동안에는 7초를 중지한다", async () => {
    const hook = await started();
    act(() => stt.onSpeech?.(now));
    stt.status = "reconnecting";
    hook.rerender({ id: 303 });

    await advance(10_000);
    expect(submitPreparedAnswer).not.toHaveBeenCalled();

    stt.status = "listening";
    hook.rerender({ id: 303 });
    await advance(7_100);

    expect(submitPreparedAnswer).toHaveBeenCalledTimes(1);
  });

  it("[다시 연결] 전에 인식된 글이 있으면 7초 뒤 자동 제출한다", async () => {
    const hook = await started();
    await advance(50_000);

    act(() => hook.result.current.reconnect());
    await advance(7_100);

    expect(submitPreparedAnswer).toHaveBeenCalledTimes(1);
  });

  it("[다시 연결] 전에 인식된 글이 없으면 음성 인식을 새로 연결하고 60초를 그때부터 다시 계산한다", async () => {
    stt.answer = { content: "", tokens: null };
    const hook = await started();
    await advance(50_000);

    act(() => hook.result.current.reconnect());
    await advance(50_000);

    expect(stt.reconnect).toHaveBeenCalledTimes(1);
    expect(hook.result.current.phase).toBe("listening");
  });

  it("화면을 이탈하면 타이머를 해제하고 마이크를 해제한다", async () => {
    const hook = await started();
    calls.length = 0;

    hook.unmount();

    expect(calls).toEqual(["capture.dispose"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useVideoAnswer 5.11 리액션", () => {
  it("듣는 중 문장이 끝날 때마다 seq를 증가시켜 5.11을 전송하고 응답을 전달한다", async () => {
    await started();

    await act(async () => {
      stt.onSentence?.({ text: "경험입니다.", pauseMs: 400 });
      stt.onSentence?.({ text: "줄였어요.", pauseMs: 300 });
    });

    expect(sendReaction.mock.calls).toEqual([
      [55, 303, { seq: 1, text: "경험입니다.", pauseMs: 400 }],
      [55, 303, { seq: 2, text: "줄였어요.", pauseMs: 300 }],
    ]);
    expect(onReaction.mock.calls.map(([r]) => r.seq)).toEqual([1, 2]);
  });

  it("제출을 시작하면 더 전송하지 않는다(음성 인식 stop 중에 도착한 마지막 문장도)", async () => {
    const hook = await started();
    stt.stop.mockImplementationOnce(async () => {
      calls.push("stt.stop");
      // stop()은 남은 음성의 최종 결과를 기다리므로 그 사이 끝 감지로 문장이 전달될 수 있다.
      stt.onSentence?.({ text: "마지막 문장입니다.", pauseMs: 0 });
    });

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(sendReaction).not.toHaveBeenCalled();
  });

  it("60초 종료 뒤에 뒤늦게 도착한 문장은 전송하지 않는다", async () => {
    await started();
    await advance(60_000);

    await act(async () => {
      stt.onSentence?.({ text: "늦은 문장입니다.", pauseMs: 0 });
    });

    expect(sendReaction).not.toHaveBeenCalled();
  });

  it("답변을 시작하기 전에는 전송하지 않는다", async () => {
    render();

    await act(async () => {
      stt.onSentence?.({ text: "경험입니다.", pauseMs: 0 });
    });

    expect(sendReaction).not.toHaveBeenCalled();
  });
});

describe("useVideoAnswer 질문 전환 · 화면 이탈 · 실패 정리", () => {
  it("다음 질문으로 변경되면 답변 전으로 돌아가 다시 [답변 시작]할 수 있다", async () => {
    const hook = await started();
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(hook.result.current.phase).toBe("submitted");

    hook.rerender({ id: 304 });
    expect(hook.result.current.phase).toBe("idle");
    await act(async () => {
      await hook.result.current.start();
    });

    expect(createAnswerAudioUploadUrl).toHaveBeenLastCalledWith(55, 304, "audio/webm");
    expect(hook.result.current.phase).toBe("listening");
  });

  it("답변 도중 질문이 변경되면 음성 인식을 취소하고 마이크를 해제한다", async () => {
    const hook = await started();
    calls.length = 0;

    hook.rerender({ id: 304 });

    expect(calls).toEqual(["stt.cancel", "capture.dispose"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("파일 녹음을 중지하는 중에 화면을 이탈하면 업로드 · 5.7을 수행하지 않는다", async () => {
    let finishFile: (blob: Blob) => void = () => {};
    capture.stopFile.mockImplementationOnce(
      () => new Promise<Blob | null>((resolve) => (finishFile = resolve)),
    );
    const hook = await started();
    let submitting: Promise<void> = Promise.resolve();
    await act(async () => {
      submitting = hook.result.current.submit();
      // 음성 인식 stop이 완료되고 파일 녹음 stop을 기다리는 시점까지 진행한다.
      for (let i = 0; i < 5 && capture.stopFile.mock.calls.length === 0; i++)
        await Promise.resolve();
    });
    expect(capture.stopFile).toHaveBeenCalledTimes(1);

    hook.unmount();
    await act(async () => {
      finishFile(new Blob(["webm"]));
      await submitting;
    });

    expect(submitPreparedAnswer).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("제출이 실패하면 마이크를 해제한다(다시 전송할 음성은 제출 데이터에 있다)", async () => {
    submitPreparedAnswer.mockResolvedValueOnce({
      kind: "failed",
      next: {},
      failure: { ok: false, code: null, status: 502 },
    });
    const hook = await started();
    calls.length = 0;

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(calls).toContain("capture.dispose");
    expect(hook.result.current.phase).toBe("submitFailed");
  });
});
