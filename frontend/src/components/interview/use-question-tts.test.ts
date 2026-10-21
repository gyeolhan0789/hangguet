import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TtsTokenActionResult } from "@/lib/interview/actions";
import { QUESTION_VOICE_FAILED } from "@/lib/messages";

import { useQuestionTts, type QuestionTtsTarget } from "./use-question-tts";

// 기준: Swagger 5.12 질문 음성 토큰 · API 명세 5.12(연결할 때마다 새 토큰, 실패하면 글로 진행) · ElevenLabs stream-input 공식 API 문서
// (응답 audio · alignment, isFinal 응답은 audio null)
// WebSocket과 AudioContext는 테스트 대역이다. 실제 ElevenLabs 응답 형식 · 디코드 · 소리는 브라우저에서 확인해야 한다.

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: unknown[] = [];
  send = vi.fn((data: string) => this.sent.push(JSON.parse(data)));
  close = vi.fn();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.();
  }

  receive(output: unknown) {
    this.onmessage?.({ data: JSON.stringify(output) } as MessageEvent);
  }
}

class FakeSourceNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  /** true면 resume해도 재개되지 않는다(자동재생 정책) */
  static blocked = false;
  /** 디코드 결과 길이(초) */
  static decodedSeconds = 1.2;
  static decodeFails = false;

  state: AudioContextState = "suspended";
  currentTime = 0;
  destination = {};
  decoded: Uint8Array[] = [];
  nodes: FakeSourceNode[] = [];
  close = vi.fn(async () => {});
  resume = vi.fn(async () => {
    if (!FakeAudioContext.blocked) this.state = "running";
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  decodeAudioData = vi.fn(async (data: ArrayBuffer) => {
    if (FakeAudioContext.decodeFails) throw new DOMException("Unable to decode", "EncodingError");
    this.decoded.push(new Uint8Array(data));
    return { duration: FakeAudioContext.decodedSeconds } as AudioBuffer;
  });

  createBufferSource() {
    const node = new FakeSourceNode();
    this.nodes.push(node);
    return node;
  }
}

const issueTtsToken =
  vi.fn<(sessionId: number, questionId: number) => Promise<TtsTokenActionResult>>();
vi.mock("@/lib/interview/actions", () => ({
  issueTtsToken: (sessionId: number, questionId: number) => issueTtsToken(sessionId, questionId),
}));

const TARGET: QuestionTtsTarget = {
  sessionId: 55,
  questionId: 303,
  content: "자기소개를 해 주세요.",
};
const TOKEN = {
  ok: true,
  token: "sutkn_1",
  expiresAt: "2026-10-15T12:21:12+09:00",
  voiceId: "voice-1",
  modelId: "eleven_flash_v2_5",
} as const satisfies TtsTokenActionResult;

const sockets = FakeWebSocket.instances;
const lastSocket = () => sockets[sockets.length - 1];
const audio = () => FakeAudioContext.instances[0];
const lastNode = () => audio().nodes[audio().nodes.length - 1];

/** 바이트 값을 base64로 변환한다 */
function base64(...bytes: number[]) {
  return btoa(String.fromCharCode(...bytes));
}

const flush = () => act(async () => {});

function render() {
  return renderHook(() => useQuestionTts());
}

/** play() 뒤 5.12 성공 · 연결 열림까지 */
async function connected(target = TARGET) {
  const hook = render();
  act(() => hook.result.current.play(target));
  await flush();
  act(() => lastSocket().open());
  return hook;
}

/** 조각 두 개(2바이트 · 4바이트)와 끝 응답을 수신한다 */
function receiveVoice(ws = lastSocket()) {
  act(() => {
    ws.receive({
      audio: base64(1, 2),
      alignment: { chars: ["자", "기"], charStartTimesMs: [0, 150], charDurationsMs: [150, 200] },
      normalizedAlignment: null,
    });
    ws.receive({
      audio: base64(3, 4, 5, 6),
      alignment: { chars: ["소"], charStartTimesMs: [30], charDurationsMs: [170] },
    });
    ws.receive({ audio: null, isFinal: true });
  });
}

async function played() {
  const hook = await connected();
  receiveVoice();
  await flush();
  return hook;
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  FakeAudioContext.instances.length = 0;
  FakeAudioContext.blocked = false;
  FakeAudioContext.decodedSeconds = 1.2;
  FakeAudioContext.decodeFails = false;
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  issueTtsToken.mockReset();
  issueTtsToken.mockResolvedValue(TOKEN);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useQuestionTts 연결과 재생", () => {
  it("play()는 5.12를 한 번 호출하고 발급받은 토큰 · voiceId · modelId로 바로 연결한다", async () => {
    const hook = render();
    act(() => hook.result.current.play(TARGET));
    expect(hook.result.current.status).toBe("loading");
    await flush();

    expect(issueTtsToken).toHaveBeenCalledExactlyOnceWith(55, 303);
    expect(sockets).toHaveLength(1);
    const url = new URL(lastSocket().url);
    expect(url.pathname).toBe("/v1/text-to-speech/voice-1/stream-input");
    expect(url.searchParams.get("single_use_token")).toBe("sutkn_1");
    expect(url.searchParams.get("model_id")).toBe("eleven_flash_v2_5");
  });

  it("연결이 열리면 공백 → 질문 글(flush) → 빈 글을 전송한다", async () => {
    await connected();

    expect(lastSocket().sent).toEqual([
      { text: " " },
      { text: "자기소개를 해 주세요. ", flush: true },
      { text: "" },
    ]);
  });

  it("끝 응답(isFinal, audio null)까지 수신한 조각을 이어 한 번에 디코드하고 재생한다", async () => {
    const hook = await played();

    expect(audio().decodeAudioData).toHaveBeenCalledTimes(1);
    // 끝 응답의 audio(null)는 조각에 포함하지 않는다.
    expect([...audio().decoded[0]]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(lastNode().start).toHaveBeenCalledTimes(1);
    expect(lastSocket().close).toHaveBeenCalled();
    expect(hook.result.current).toMatchObject({
      status: "playing",
      isSpeaking: true,
      failure: null,
      failureMessage: null,
    });
  });

  it("timeline은 조각 길이(전체 길이를 바이트 수에 비례해 나눈 값)를 누적해 계산한다", async () => {
    // 1.2초를 2바이트 : 4바이트로 나누면 400ms · 800ms다.
    const hook = await played();

    expect(hook.result.current.timeline).toEqual([
      { char: "자", startMs: 0, endMs: 150 },
      { char: "기", startMs: 150, endMs: 350 },
      { char: "소", startMs: 430, endMs: 600 },
    ]);
  });

  it("getPlaybackMs는 재생 시작부터 AudioContext 시계로 측정한 ms이고, 끝나면 ended · null이다", async () => {
    const hook = await played();
    expect(hook.result.current.getPlaybackMs()).toBe(0);

    audio().currentTime = 0.75;
    expect(hook.result.current.getPlaybackMs()).toBe(750);

    act(() => lastNode().onended?.());
    expect(hook.result.current).toMatchObject({ status: "ended", isSpeaking: false });
    expect(hook.result.current.getPlaybackMs()).toBeNull();
  });

  it("재생 전에는 getPlaybackMs가 null이다", () => {
    expect(render().result.current.getPlaybackMs()).toBeNull();
  });

  it("play()를 호출할 때마다 5.12를 한 번씩 호출한다(수신한 음성이 있어도)", async () => {
    const hook = await played();

    act(() => hook.result.current.play(TARGET));
    await flush();

    expect(issueTtsToken).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
  });
});

describe("useQuestionTts 실패", () => {
  it.each([
    { name: "503 TTS_UNAVAILABLE", result: { ok: false, code: "TTS_UNAVAILABLE", status: 503 } },
    { name: "본문 없는 502", result: { ok: false, code: null, status: 502 } },
    { name: "본문 없는 504", result: { ok: false, code: null, status: 504 } },
    {
      name: "404 QUESTION_NOT_FOUND",
      result: { ok: false, code: "QUESTION_NOT_FOUND", status: 404 },
    },
    {
      name: "409 INVALID_SESSION_STATE",
      result: { ok: false, code: "INVALID_SESSION_STATE", status: 409 },
    },
    { name: "응답 없음", result: { ok: false, code: null, status: null } },
  ] satisfies { name: string; result: TtsTokenActionResult }[])(
    "$name: 5.12가 실패하면 연결하지 않고 failed(token)와 안내 문구를 설정한다",
    async ({ result }) => {
      issueTtsToken.mockResolvedValue(result);
      const hook = render();
      act(() => hook.result.current.play(TARGET));
      await flush();

      expect(sockets).toHaveLength(0);
      expect(hook.result.current).toMatchObject({
        status: "failed",
        failure: "token",
        failureMessage: QUESTION_VOICE_FAILED,
        isSpeaking: false,
      });
    },
  );

  it("5.12 서버 액션 호출 자체가 실패(reject)하면 loading에 남지 않고 failed(token)", async () => {
    issueTtsToken.mockRejectedValue(new Error("Failed to find Server Action"));
    const hook = render();
    act(() => hook.result.current.play(TARGET));
    await flush();

    expect(sockets).toHaveLength(0);
    expect(hook.result.current).toMatchObject({ status: "failed", failure: "token" });
  });

  it("WebSocket 생성에서 예외가 발생하면 failed(token)", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new SyntaxError("invalid url");
        }
      },
    );
    const hook = render();
    act(() => hook.result.current.play(TARGET));
    await flush();

    expect(hook.result.current).toMatchObject({ status: "failed", failure: "token" });
  });

  it("연결이 열리기 전에 오류가 발생하면 failed(connect)", async () => {
    const hook = render();
    act(() => hook.result.current.play(TARGET));
    await flush();
    act(() => lastSocket().onerror?.());

    expect(hook.result.current).toMatchObject({ status: "failed", failure: "connect" });
  });

  it("끝 응답(isFinal) 전에 연결이 끊기면 failed(closedEarly)이고 수신한 조각은 재생하지 않는다", async () => {
    const hook = await connected();
    act(() => {
      lastSocket().receive({ audio: base64(1, 2), alignment: null });
      lastSocket().onclose?.();
    });
    await flush();

    expect(hook.result.current).toMatchObject({ status: "failed", failure: "closedEarly" });
    expect(audio().decodeAudioData).not.toHaveBeenCalled();
  });

  it("JSON이 아니거나 audio · isFinal이 없는 메시지는 폐기하고 계속 수신한다", async () => {
    const hook = await connected();
    act(() => {
      lastSocket().onmessage?.({ data: "not json" } as MessageEvent);
      lastSocket().receive({ message: "unknown" });
    });
    receiveVoice();
    await flush();

    expect([...audio().decoded[0]]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hook.result.current.status).toBe("playing");
  });

  it("음성 조각 없이 끝 응답이 도착하면 failed(playback)", async () => {
    const hook = await connected();
    act(() => lastSocket().receive({ audio: null, isFinal: true }));
    await flush();

    expect(hook.result.current).toMatchObject({ status: "failed", failure: "playback" });
  });

  it("수신한 음성을 디코드하지 못하면 failed(playback)", async () => {
    FakeAudioContext.decodeFails = true;
    const hook = await played();

    expect(hook.result.current).toMatchObject({ status: "failed", failure: "playback" });
  });

  it("연결 뒤 5초 안에 첫 음성 조각이 도착하지 않으면 failed(timeout)이고 연결을 닫는다", async () => {
    vi.useFakeTimers();
    const hook = await connected();

    act(() => vi.advanceTimersByTime(4_999));
    expect(hook.result.current.status).toBe("loading");
    act(() => vi.advanceTimersByTime(1));

    expect(hook.result.current).toMatchObject({ status: "failed", failure: "timeout" });
    expect(lastSocket().close).toHaveBeenCalled();
  });

  it("첫 음성 조각이 5초 안에 도착하면 첫 음성 시간 초과로 끊지 않는다", async () => {
    vi.useFakeTimers();
    const hook = await connected();
    act(() => vi.advanceTimersByTime(4_000));
    act(() => lastSocket().receive({ audio: base64(1), alignment: null }));
    act(() => vi.advanceTimersByTime(5_000));

    expect(hook.result.current.status).toBe("loading");
  });

  it("첫 음성 뒤 끝 응답이 play() 뒤 10초 안에 도착하지 않으면 failed(timeout)이고 연결을 닫는다", async () => {
    vi.useFakeTimers();
    const hook = await connected();
    act(() => lastSocket().receive({ audio: base64(1), alignment: null }));

    act(() => vi.advanceTimersByTime(9_999));
    expect(hook.result.current.status).toBe("loading");
    act(() => vi.advanceTimersByTime(1));

    expect(hook.result.current).toMatchObject({ status: "failed", failure: "timeout" });
    expect(lastSocket().close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("5.12 응답이 도착하지 않아도 play() 뒤 10초면 failed(timeout)이고, 뒤늦게 도착한 토큰으로 연결하지 않는다", async () => {
    vi.useFakeTimers();
    let resolve!: (result: TtsTokenActionResult) => void;
    issueTtsToken.mockReturnValue(new Promise((r) => (resolve = r)));
    const hook = render();
    act(() => hook.result.current.play(TARGET));

    act(() => vi.advanceTimersByTime(10_000));
    expect(hook.result.current).toMatchObject({ status: "failed", failure: "timeout" });

    resolve(TOKEN);
    await flush();
    expect(sockets).toHaveLength(0);
  });

  it("자동재생 정책으로 소리를 낼 수 없으면 failed(blocked)이고, 누른 뒤 replay()하면 수신한 음성으로 재생한다", async () => {
    FakeAudioContext.blocked = true;
    const hook = await played();
    expect(hook.result.current).toMatchObject({ status: "failed", failure: "blocked" });

    FakeAudioContext.blocked = false;
    act(() => hook.result.current.replay());
    await flush();

    expect(hook.result.current.status).toBe("playing");
    expect(issueTtsToken).toHaveBeenCalledTimes(1);
  });

  it("실패해도 스스로 다시 시도하지 않는다", async () => {
    issueTtsToken.mockResolvedValue({ ok: false, code: "TTS_UNAVAILABLE", status: 503 });
    const hook = render();
    act(() => hook.result.current.play(TARGET));
    await flush();
    await flush();

    expect(issueTtsToken).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("failed");
  });
});

describe("useQuestionTts 다시 듣기(같은 화면 캐시)", () => {
  it("끝까지 수신한 질문이면 5.12를 호출하지 않고 수신한 음성을 처음부터 다시 재생한다", async () => {
    const hook = await played();
    const first = lastNode();
    act(() => first.onended?.());

    act(() => hook.result.current.replay());
    await flush();

    expect(issueTtsToken).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    expect(audio().decodeAudioData).toHaveBeenCalledTimes(1);
    expect(lastNode()).not.toBe(first);
    expect(lastNode().buffer).toBe(first.buffer);
    expect(hook.result.current.status).toBe("playing");
  });

  it("수신한 음성이 없으면(끝까지 수신하기 전에 실패) 5.12를 다시 호출해 연결한다", async () => {
    const hook = await connected();
    act(() => lastSocket().onclose?.());

    act(() => hook.result.current.replay());
    await flush();

    expect(issueTtsToken).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
  });

  it("다른 질문의 음성은 사용하지 않는다", async () => {
    const hook = await played();
    act(() => hook.result.current.play({ ...TARGET, questionId: 304 }));
    await flush();
    act(() => lastSocket().onclose?.());

    act(() => hook.result.current.replay());
    await flush();

    expect(issueTtsToken).toHaveBeenLastCalledWith(55, 304);
    expect(issueTtsToken).toHaveBeenCalledTimes(3);
  });

  it("재생한 적이 없으면 아무것도 하지 않는다", () => {
    const hook = render();
    act(() => hook.result.current.replay());

    expect(issueTtsToken).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
  });
});

describe("useQuestionTts 재생 세대", () => {
  it("5.12를 기다리는 중에 stop()하면 토큰이 뒤늦게 도착해도 연결하지 않는다", async () => {
    let resolve!: (result: TtsTokenActionResult) => void;
    issueTtsToken.mockReturnValue(new Promise((r) => (resolve = r)));
    const hook = render();
    act(() => hook.result.current.play(TARGET));
    act(() => hook.result.current.stop());

    resolve(TOKEN);
    await flush();

    expect(sockets).toHaveLength(0);
    expect(hook.result.current.status).toBe("idle");
  });

  it("5.12를 기다리는 중에 stop()하면 호출이 뒤늦게 reject돼도 failed가 되지 않는다", async () => {
    let reject!: (error: Error) => void;
    issueTtsToken.mockReturnValue(new Promise((_, r) => (reject = r)));
    const hook = render();
    act(() => hook.result.current.play(TARGET));
    act(() => hook.result.current.stop());

    reject(new Error("network"));
    await flush();

    expect(hook.result.current.status).toBe("idle");
  });

  it("앞 play()의 5.12가 뒤 play()보다 늦게 도착해도 뒤 질문만 연결한다", async () => {
    const pending: ((result: TtsTokenActionResult) => void)[] = [];
    issueTtsToken.mockImplementation(() => new Promise((r) => pending.push(r)));
    const hook = render();
    act(() => hook.result.current.play(TARGET));
    act(() => hook.result.current.play({ ...TARGET, questionId: 304, content: "다음 질문" }));

    pending[1]({ ...TOKEN, token: "sutkn_2" });
    await flush();
    pending[0](TOKEN);
    await flush();

    expect(sockets).toHaveLength(1);
    expect(new URL(lastSocket().url).searchParams.get("single_use_token")).toBe("sutkn_2");
  });

  it("재생 중에 play()하면 앞 소리를 종료하고 새로 수신한다", async () => {
    const hook = await played();
    const first = lastNode();
    const firstSocket = lastSocket();

    act(() => hook.result.current.play({ ...TARGET, questionId: 304 }));
    await flush();

    expect(first.stop).toHaveBeenCalled();
    expect(firstSocket.close).toHaveBeenCalled();
    expect(issueTtsToken).toHaveBeenLastCalledWith(55, 304);
    expect(hook.result.current.status).toBe("loading");
  });

  it("음성을 수신하는 중에 play()하면 앞 연결을 닫고 그 연결의 응답은 폐기한다", async () => {
    const hook = await connected();
    const firstSocket = lastSocket();
    act(() => firstSocket.receive({ audio: base64(1), alignment: null }));

    act(() => hook.result.current.play({ ...TARGET, questionId: 304 }));
    await flush();
    act(() => lastSocket().open());
    receiveVoice(firstSocket);
    await flush();

    expect(firstSocket.close).toHaveBeenCalled();
    expect(audio().decodeAudioData).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("loading");
  });

  it("디코드를 기다리는 중에 stop()하면 디코드가 끝나도 재생하지 않는다", async () => {
    const hook = await connected();
    let finishDecode!: () => void;
    audio().decodeAudioData.mockImplementationOnce(
      () => new Promise((r) => (finishDecode = () => r({ duration: 1 } as AudioBuffer))),
    );
    receiveVoice();
    act(() => hook.result.current.stop());
    finishDecode();
    await flush();

    expect(audio().nodes).toHaveLength(0);
    expect(hook.result.current.status).toBe("idle");
  });

  it("디코드를 기다리는 중에 stop()하면 디코드가 실패해도 failed가 되지 않는다", async () => {
    const hook = await connected();
    let failDecode!: () => void;
    audio().decodeAudioData.mockImplementationOnce(
      () => new Promise((_, reject) => (failDecode = () => reject(new Error("decode")))),
    );
    receiveVoice();
    act(() => hook.result.current.stop());
    failDecode();
    await flush();

    expect(hook.result.current).toMatchObject({ status: "idle", failure: null });
  });

  it("디코드를 기다리는 중에 화면을 떠나면 디코드가 끝나도 AudioContext를 다시 생성하지 않는다", async () => {
    const hook = await connected();
    let finishDecode!: () => void;
    audio().decodeAudioData.mockImplementationOnce(
      () => new Promise((r) => (finishDecode = () => r({ duration: 1 } as AudioBuffer))),
    );
    receiveVoice();
    hook.unmount();
    finishDecode();
    await flush();

    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("다시 듣기로 AudioContext를 재개하는 중에 stop()하면 재생하지 않는다", async () => {
    const hook = await played();
    act(() => lastNode().onended?.());

    act(() => {
      hook.result.current.replay();
      hook.result.current.stop();
    });
    await flush();

    expect(audio().nodes).toHaveLength(1);
    expect(hook.result.current.status).toBe("idle");
  });

  it("재생 중에 replay()하면 앞 소리를 종료하고 처음부터 다시 재생한다", async () => {
    const hook = await played();
    const first = lastNode();

    act(() => hook.result.current.replay());
    await flush();

    expect(first.stop).toHaveBeenCalled();
    expect(audio().nodes).toHaveLength(2);
    expect(hook.result.current.status).toBe("playing");
  });

  it("stop()하면 소리를 중지하고 연결을 닫는다", async () => {
    const hook = await played();

    act(() => hook.result.current.stop());

    expect(lastNode().stop).toHaveBeenCalled();
    expect(hook.result.current).toMatchObject({ status: "idle", isSpeaking: false });
    expect(hook.result.current.getPlaybackMs()).toBeNull();
  });
});

describe("useQuestionTts 정리", () => {
  it("화면을 떠나면 연결을 닫고 첫 음성 · 전체 기한 타이머를 해제하고 AudioContext를 닫는다", async () => {
    vi.useFakeTimers();
    const removeListener = vi.spyOn(window, "removeEventListener");
    const hook = await connected();
    expect(vi.getTimerCount()).toBe(2);

    hook.unmount();

    expect(lastSocket().close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(audio().close).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("pointerdown", expect.any(Function));
  });

  it("떠난 뒤 5.12가 뒤늦게 도착해도 연결하지 않는다", async () => {
    let resolve!: (result: TtsTokenActionResult) => void;
    issueTtsToken.mockReturnValue(new Promise((r) => (resolve = r)));
    const hook = render();
    act(() => hook.result.current.play(TARGET));

    hook.unmount();
    resolve(TOKEN);
    await flush();

    expect(sockets).toHaveLength(0);
  });

  it("AudioContext는 하나만 생성하고, 처음 누를 때 재개(resume)한다", async () => {
    const hook = await played();
    act(() => hook.result.current.play(TARGET));
    await flush();
    expect(FakeAudioContext.instances).toHaveLength(1);

    const calls = audio().resume.mock.calls.length;
    window.dispatchEvent(new Event("pointerdown"));
    expect(audio().resume).toHaveBeenCalledTimes(calls + 1);
  });
});
