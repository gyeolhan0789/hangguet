import { AuthError, QuotaError, type AudioSource, type RealtimeToken } from "@soniox/client";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SttTokenActionResult } from "@/lib/interview/actions";
import type { AnswerCapture } from "@/lib/stt/answer-capture";

import { useAnswerStt, type AnswerSttStart } from "./use-answer-stt";

// 기준: Swagger 5.10 실시간 음성 인식 토큰 · API 명세 5.7(tokens 시각 · 7초 기준)
// 훅 규칙만 확인한다. SonioxClient만 테스트 대역으로 대체하고 오류 클래스(AuthError · QuotaError)는 SDK 것을 그대로 사용한다.
// SDK와 맞물리는 동작(재연결 · stop · 같은 틱 정리)은 use-answer-stt.sdk.test.ts가 실제 SDK로 확인한다.

type Handler = (...args: never[]) => void;

const sdk = vi.hoisted(() => {
  class FakeRecording {
    private readonly handlers = new Map<string, Set<Handler>>();
    cancel = vi.fn();
    stop = vi.fn(async () => {});

    constructor(
      readonly options: Record<string, unknown> & { signal: AbortSignal; source: unknown },
      readonly config: () => Promise<{ api_key: string }>,
    ) {
      // SDK Recording.handleAbort처럼, 시작 단계에서 abort되면 error를 발생시킨다.
      options.signal.addEventListener("abort", () =>
        this.emit("error", new Error("Recording aborted")),
      );
    }

    on(event: string, handler: Handler) {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(handler);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      this.handlers
        .get(event)
        ?.forEach((handler) => (handler as (...a: unknown[]) => void)(...args));
    }
  }

  const recordings: FakeRecording[] = [];

  class FakeSonioxClient {
    realtime: { record: (options: FakeRecording["options"]) => FakeRecording };
    constructor({ config }: { config: () => Promise<{ api_key: string }> }) {
      this.realtime = {
        record: (options) => {
          const recording = new FakeRecording(options, config);
          recordings.push(recording);
          return recording;
        },
      };
    }
  }

  return { FakeSonioxClient, recordings };
});

vi.mock("@soniox/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@soniox/client")>()),
  SonioxClient: sdk.FakeSonioxClient,
}));

const issueSttToken = vi.fn<(sessionId: number) => Promise<SttTokenActionResult>>();
vi.mock("@/lib/interview/actions", () => ({
  issueSttToken: (sessionId: number) => issueSttToken(sessionId),
}));

const recordings = sdk.recordings;
const last = () => recordings[recordings.length - 1];
const onSpeech = vi.fn();
const onSentence = vi.fn();
let sttStartedAt: number | null = null;
let now = 0;
const source = {} as AudioSource;

function fakeCapture(): AnswerCapture {
  return {
    start: vi.fn(),
    stopFile: vi.fn(),
    createSttSource: vi.fn(() => source),
    getSttStartedAt: () => sttStartedAt,
    dispose: vi.fn(),
  };
}

function token(text: string, startMs: number, endMs: number, isFinal = true): RealtimeToken {
  return { text, start_ms: startMs, end_ms: endMs, confidence: 1, is_final: isFinal };
}

function started(answer: Partial<AnswerSttStart> = {}) {
  const capture = fakeCapture();
  const hook = renderHook(() => useAnswerStt({ sessionId: 7, onSpeech, onSentence }));
  act(() =>
    hook.result.current.start({ capture, fileStartedAt: 1000, questionText: "질문", ...answer }),
  );
  return { hook, capture };
}

function emit(event: string, ...args: unknown[]) {
  act(() => last().emit(event, ...args));
}

beforeEach(() => {
  recordings.length = 0;
  issueSttToken.mockReset();
  onSpeech.mockReset();
  onSentence.mockReset();
  sttStartedAt = null;
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useAnswerStt 연결", () => {
  it("record에 모델 · 언어 · 끝 감지 · 맥락 · 답변 녹음 소스 · 자동 재연결 · signal을 전달한다", () => {
    const { capture } = started({ questionText: "트랜잭션 격리 수준을 설명해 주세요" });

    expect(recordings).toHaveLength(1);
    expect(last().options).toMatchObject({
      model: "stt-rt-v5",
      language_hints: ["ko", "en"],
      enable_endpoint_detection: true,
      auto_reconnect: true,
      source,
      context: { text: "트랜잭션 격리 수준을 설명해 주세요" },
    });
    expect(last().options.signal).toBeInstanceOf(AbortSignal);
    expect(capture.createSttSource).toHaveBeenCalledTimes(1);
  });

  it("config는 호출될 때마다 5.10을 새로 호출해 그 키를 반환한다", async () => {
    started();
    issueSttToken
      .mockResolvedValueOnce({ ok: true, token: "key-1", expiresAt: "2026-10-21T00:05:00Z" })
      .mockResolvedValueOnce({ ok: true, token: "key-2", expiresAt: "2026-10-21T00:10:00Z" });

    await expect(last().config()).resolves.toEqual({ api_key: "key-1" });
    await expect(last().config()).resolves.toEqual({ api_key: "key-2" });
    expect(issueSttToken).toHaveBeenCalledTimes(2);
    expect(issueSttToken).toHaveBeenCalledWith(7);
  });

  it("5.10이 실패하면 config가 실패해 SDK가 error로 종료하게 한다", async () => {
    started();
    issueSttToken.mockResolvedValueOnce({ ok: false, code: "STT_UNAVAILABLE", status: 503 });

    await expect(last().config()).rejects.toThrow();
  });

  it.each([
    { state: "starting", reason: "user_action", status: "connecting" },
    { state: "recording", reason: "connected", status: "listening" },
    { state: "reconnecting", reason: "connection_lost", status: "reconnecting" },
    { state: "connecting", reason: "reconnecting", status: "reconnecting" },
    { state: "recording", reason: "reconnected", status: "listening" },
    { state: "stopping", reason: "user_action", status: "idle" },
    { state: "error", reason: "error", status: "error" },
  ])("SDK 상태 $state($reason) → $status", ({ state, reason, status }) => {
    const { hook } = started();

    emit("state_change", { old_state: "idle", new_state: state, reason });

    expect(hook.result.current.status).toBe(status);
  });
});

describe("useAnswerStt 시각 보정", () => {
  it("첫 연결은 음성 인식 녹음기 시작 − 파일 시작을 offset으로 더한다", () => {
    const { hook } = started({ fileStartedAt: 1000 });
    sttStartedAt = 1300;

    emit("connected");
    emit("result", { tokens: [token("네", 100, 200)] });

    expect(hook.result.current.getAnswer()).toEqual({
      content: "네",
      tokens: [{ text: "네", startMs: 400, endMs: 500 }],
    });
  });

  it("자동 재연결(session_restart)이면 새 녹음기 시작 시각으로 offset을 새로 계산한다", () => {
    const { hook } = started({ fileStartedAt: 1000 });
    sttStartedAt = 1300;
    emit("connected");
    emit("result", { tokens: [token("첫", 100, 200)] });

    sttStartedAt = 5000;
    emit("session_restart", { reset_transcript: false });
    emit("connected");
    emit("result", { tokens: [token(" 둘째", 0, 100)] });

    expect(hook.result.current.getAnswer().tokens).toEqual([
      { text: "첫", startMs: 400, endMs: 500 },
      { text: " 둘째", startMs: 4000, endMs: 4100 },
    ]);
  });

  it("자막은 확정 글 + 미확정 글이다", () => {
    const { hook } = started();
    emit("connected");

    emit("result", { tokens: [token("저는", 0, 300), token(" 개", 300, 400, false)] });

    expect(hook.result.current.caption).toBe("저는 개");
  });
});

describe("useAnswerStt 말소리 신호(onSpeech)", () => {
  it("비공백 토큰 end_ms 최댓값이 늘어난 result에서만 그 도착 시각으로 호출한다", () => {
    started();
    emit("connected");

    now = 2000;
    emit("result", { tokens: [token("안녕", 0, 500, false)] });
    now = 2100;
    emit("result", { tokens: [token("안녕", 0, 500, false)] });
    emit("result", { tokens: [token(" ", 500, 900, false)] });
    emit("result", { tokens: [] });
    now = 2500;
    emit("result", { tokens: [token("안녕하세요", 0, 800, false)] });

    expect(onSpeech.mock.calls).toEqual([[2000], [2500]]);
  });

  it("새 연결이면 최댓값을 처음부터 계산한다", () => {
    started();
    emit("connected");
    emit("result", { tokens: [token("네", 0, 900)] });

    emit("session_restart", { reset_transcript: false });
    now = 7000;
    emit("result", { tokens: [token("다시", 0, 300, false)] });

    expect(onSpeech).toHaveBeenCalledTimes(2);
    expect(onSpeech).toHaveBeenLastCalledWith(7000);
  });
});

describe("useAnswerStt 문장 끝(onSentence, API 명세 5.11)", () => {
  function result(tokens: RealtimeToken[], totalAudioProcMs: number) {
    return { tokens, final_audio_proc_ms: totalAudioProcMs, total_audio_proc_ms: totalAudioProcMs };
  }

  it("끝 감지가 발생하면 종결어미로 끝난 확정 글과 pauseMs(total_audio_proc_ms − 마지막 end_ms)를 전달한다", () => {
    started();
    emit("connected");
    emit("result", result([token(" 경험입니다.", 1500, 2000)], 3150));
    expect(onSentence).not.toHaveBeenCalled();

    emit("endpoint");

    expect(onSentence).toHaveBeenCalledExactlyOnceWith({ text: "경험입니다.", pauseMs: 1150 });
  });

  it("종결어미로 끝나지 않으면 전달하지 않고 다음 끝 감지까지 이어 붙인다", () => {
    started();
    emit("connected");
    emit("result", result([token(" 몰랐는데,", 0, 1000)], 4000));
    emit("endpoint");
    emit("result", result([token(" 찾았습니다.", 5000, 5600)], 6700));
    emit("endpoint");

    expect(onSentence.mock.calls).toEqual([[{ text: "몰랐는데, 찾았습니다.", pauseMs: 1100 }]]);
  });

  it("자동 재연결(session_restart) 뒤에는 앞 연결의 end_ms를 폐기해, 새 토큰 없이 끝 감지가 발생하면 pauseMs를 0으로 전송한다", () => {
    started();
    emit("connected");
    emit("result", result([token(" 줄였어요.", 200, 500)], 600));
    emit("session_restart");
    // 새 연결의 시각은 0부터 다시 시작해 앞 연결의 end_ms(500)와 비교할 수 없다.
    emit("result", result([], 3_000));
    emit("endpoint");

    expect(onSentence).toHaveBeenCalledExactlyOnceWith({ text: "줄였어요.", pauseMs: 0 });
  });

  it("새 답변을 시작하면 앞 답변의 이어 붙이던 글을 폐기한다", () => {
    const { hook, capture } = started();
    emit("connected");
    emit("result", result([token(" 그래서", 0, 500)], 900));
    emit("endpoint");

    act(() => hook.result.current.start({ capture, fileStartedAt: 1000, questionText: "질문" }));
    emit("connected");
    emit("result", result([token(" 줄였어요.", 0, 600)], 1000));
    emit("endpoint");

    expect(onSentence).toHaveBeenCalledExactlyOnceWith({ text: "줄였어요.", pauseMs: 400 });
  });
});

describe("useAnswerStt 오류", () => {
  it("AuthError면 record()를 한 번 새로 호출해 새 음성 인식 소스 · 새 offset으로 연결한다", () => {
    const { hook, capture } = started({ fileStartedAt: 1000 });
    const first = last();
    sttStartedAt = 1300;
    emit("connected");

    emit("error", new AuthError("Invalid API key", 401));
    // 앞 녹음은 폐기했으므로 그 뒤에 발생하는 상태(error)는 무시한다.
    act(() => first.emit("state_change", { old_state: "recording", new_state: "error" }));

    expect(recordings).toHaveLength(2);
    expect(first.options.signal.aborted).toBe(true);
    expect(capture.createSttSource).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status).toBe("connecting");

    sttStartedAt = 2000;
    emit("connected");
    emit("result", { tokens: [token("네", 0, 100)] });
    expect(hook.result.current.getAnswer().tokens).toEqual([
      { text: "네", startMs: 1000, endMs: 1100 },
    ]);
  });

  it("두 번째 AuthError는 다시 호출하지 않고 error", () => {
    const { hook } = started();
    emit("error", new AuthError("Invalid API key", 401));

    emit("error", new AuthError("Invalid API key", 401));

    expect(recordings).toHaveLength(2);
    expect(hook.result.current.status).toBe("error");
  });

  it("QuotaError(429)는 다시 호출하지 않고 error", () => {
    const { hook } = started();

    emit("error", new QuotaError("Too many requests", 429));

    expect(recordings).toHaveLength(1);
    expect(hook.result.current.status).toBe("error");
  });

  it("[다시 연결]은 인식된 글을 유지하고 새 record()로 연결하며, AuthError 재시도도 다시 한 번 허용한다", () => {
    const { hook } = started();
    emit("connected");
    emit("result", { tokens: [token("앞부분", 0, 300)] });
    emit("error", new AuthError("Invalid API key", 401));
    emit("error", new AuthError("Invalid API key", 401));

    act(() => hook.result.current.reconnect());
    emit("error", new AuthError("Invalid API key", 401));

    expect(recordings).toHaveLength(4);
    expect(hook.result.current.status).toBe("connecting");
    expect(hook.result.current.getAnswer().content).toBe("앞부분");
  });
});

describe("useAnswerStt 종료 · 정리", () => {
  it("stop()은 SDK stop을 기다린 뒤 idle이 되고, SDK stop이 실패해도 reject하지 않는다", async () => {
    const { hook } = started();
    last().stop.mockRejectedValueOnce(new Error("finish failed"));

    await act(() => hook.result.current.stop());

    expect(last().stop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("idle");
  });

  it("cancel()은 abort와 SDK cancel을 함께 호출하고, abort로 발생한 error는 무시하고 idle을 유지한다", () => {
    const { hook } = started();

    act(() => hook.result.current.cancel());

    expect(last().options.signal.aborted).toBe(true);
    expect(last().cancel).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("idle");
  });

  it("화면을 떠나면 abort와 SDK cancel을 호출한다", () => {
    const { hook } = started();

    hook.unmount();

    expect(last().options.signal.aborted).toBe(true);
    expect(last().cancel).toHaveBeenCalledTimes(1);
  });

  it("start 직후 같은 틱에 떠나도 abort와 cancel을 함께 호출하고 5.10은 호출하지 않는다", () => {
    const capture = fakeCapture();
    const hook = renderHook(() => useAnswerStt({ sessionId: 7 }));

    act(() => {
      hook.result.current.start({ capture, fileStartedAt: 0, questionText: "질문" });
      hook.unmount();
    });

    expect(last().options.signal.aborted).toBe(true);
    expect(last().cancel).toHaveBeenCalledTimes(1);
    expect(issueSttToken).not.toHaveBeenCalled();
  });

  it("새 답변을 start하면 앞 녹음을 폐기하고 인식된 글을 초기화한다", () => {
    const { hook, capture } = started();
    const first = last();
    emit("connected");
    emit("result", { tokens: [token("앞 답변", 0, 300)] });

    act(() => hook.result.current.start({ capture, fileStartedAt: 0, questionText: "다음" }));

    expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(hook.result.current.caption).toBe("");
    expect(hook.result.current.getAnswer()).toEqual({ content: "", tokens: [] });
  });
});
