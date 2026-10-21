import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SttTokenActionResult } from "@/lib/interview/actions";
import { createAnswerCapture } from "@/lib/stt/answer-capture";

import { useAnswerStt } from "./use-answer-stt";

// 기준: Swagger 5.10(연결할 때마다 새 키) · API 명세 5.7 · @soniox/client 2.4.0 Recording(재연결 · stop · cancel · signal)
// 실제 SDK와 실제 답변 녹음(createAnswerCapture)을 사용하고, 브라우저 경계(WebSocket · MediaRecorder · getUserMedia)와 5.10 서버 액션만 테스트 대역으로 대체한다.

const issueSttToken = vi.fn<(sessionId: number) => Promise<SttTokenActionResult>>();
vi.mock("@/lib/interview/actions", () => ({
  issueSttToken: (sessionId: number) => issueSttToken(sessionId),
}));

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  sent: unknown[] = [];

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  /** 서버가 연결을 수락한다 */
  accept() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  /** 연결 단계에서 실패한다 */
  fail() {
    this.dispatchEvent(new Event("error"));
  }

  /** 연결된 뒤 끊긴다 */
  drop() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(Object.assign(new Event("close"), { code: 1006, reason: "" }));
  }

  message(body: object) {
    this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(body) }));
  }

  /** 수신한 설정 메시지(첫 글자 메시지) */
  config() {
    return JSON.parse(this.sent.find((data) => typeof data === "string") as string);
  }
}

class FakeTrack {
  readonly kind = "audio";
  stop = vi.fn();
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}

/** 브라우저처럼 start · stop 이벤트를 비동기로 전송하는 녹음기 */
class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = () => true;
  static instances: FakeMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  readonly mimeType = "audio/webm;codecs=opus";

  constructor() {
    super();
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
    queueMicrotask(() => this.dispatchEvent(new Event("start")));
  }

  stop() {
    this.state = "inactive";
    queueMicrotask(() => this.dispatchEvent(new Event("stop")));
  }
}

const sockets = () => FakeWebSocket.instances;
const lastSocket = () => sockets()[sockets().length - 1];
let now = 0;
let keys = 0;

function tokenOk(): SttTokenActionResult {
  keys += 1;
  return { ok: true, token: `key-${keys}`, expiresAt: "2026-10-21T00:05:00Z" };
}

/** 대기 중인 마이크로태스크 · 0ms 타이머를 모두 실행한다 */
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function result(...tokens: [text: string, startMs: number, endMs: number][]) {
  return {
    tokens: tokens.map(([text, start_ms, end_ms]) => ({ text, start_ms, end_ms, is_final: true })),
    final_audio_proc_ms: 0,
    total_audio_proc_ms: 0,
  };
}

/** 파일 녹음(시각 1000)을 시작하고 음성 인식을 시작해 첫 WebSocket이 열리기 직전까지 진행한다 */
async function started() {
  const capture = createAnswerCapture();
  now = 1000;
  const begun = await capture.start();
  if (!begun.ok) throw new Error("capture failed");
  const hook = renderHook(() => useAnswerStt({ sessionId: 7 }));
  now = 1200;
  act(() =>
    hook.result.current.start({
      capture,
      fileStartedAt: begun.fileStartedAt,
      questionText: "질문",
    }),
  );
  await flush();
  return { hook, capture };
}

/** 첫 연결까지 완료한다 */
async function listening() {
  const context = await started();
  lastSocket().accept();
  await flush();
  return context;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  FakeWebSocket.instances = [];
  FakeMediaRecorder.instances = [];
  issueSttToken.mockReset();
  issueSttToken.mockImplementation(async () => tokenOk());
  keys = 0;
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("MediaStream", FakeMediaStream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => new FakeMediaStream([new FakeTrack()]) },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAnswerStt + 실제 SDK 연결", () => {
  it("5.10 키를 WebSocket 서브프로토콜로 전송하고 설정 메시지를 전송한 뒤 listening이 된다", async () => {
    const { hook } = await started();

    expect(issueSttToken).toHaveBeenCalledWith(7);
    expect(sockets()).toHaveLength(1);
    expect(lastSocket().protocols).toEqual(["soniox-api-key", "key-1"]);
    expect(hook.result.current.status).toBe("connecting");

    lastSocket().accept();
    await flush();

    expect(lastSocket().config()).toMatchObject({
      model: "stt-rt-v5",
      language_hints: ["ko", "en"],
      enable_endpoint_detection: true,
      context: { text: "질문" },
    });
    expect(hook.result.current.status).toBe("listening");
  });

  it("result를 음성 인식 녹음기 시작 − 파일 시작(200ms)으로 보정하고, stop()은 finished까지 기다린다", async () => {
    const { hook } = await listening();
    act(() => lastSocket().message(result(["안녕", 0, 300])));

    let stopped = false;
    let stopping!: Promise<void>;
    act(() => {
      stopping = hook.result.current.stop().then(() => {
        stopped = true;
      });
    });
    await flush();
    expect(stopped).toBe(false);

    act(() => lastSocket().message({ ...result(["하세요", 300, 600]), finished: true }));
    await act(() => stopping);

    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.getAnswer()).toEqual({
      content: "안녕하세요",
      tokens: [
        { text: "안녕", startMs: 200, endMs: 500 },
        { text: "하세요", startMs: 500, endMs: 800 },
      ],
    });
  });
});

describe("useAnswerStt + 실제 SDK 재연결", () => {
  it("재연결의 connect가 실패하면 남은 횟수 안에서 다음 시도로 진행하고, 시도마다 5.10을 새로 호출하며 새 offset을 사용한다", async () => {
    const { hook } = await listening();
    act(() => lastSocket().message(result(["첫", 0, 100])));

    now = 3000;
    act(() => lastSocket().drop());
    await flush();
    expect(hook.result.current.status).toBe("reconnecting");

    await flush(1000);
    expect(issueSttToken).toHaveBeenCalledTimes(2);
    expect(lastSocket().protocols).toEqual(["soniox-api-key", "key-2"]);

    now = 5000;
    act(() => lastSocket().fail());
    await flush();
    expect(hook.result.current.status).toBe("reconnecting");

    await flush(2000);
    expect(issueSttToken).toHaveBeenCalledTimes(3);
    lastSocket().accept();
    await flush();
    expect(hook.result.current.status).toBe("listening");

    act(() => lastSocket().message(result([" 셋째", 0, 100])));
    // 두 번째 재시도 때 음성 인식 녹음기를 다시 시작한 시각(5000)이 새 연결의 기준이다.
    expect(hook.result.current.getAnswer().tokens).toEqual([
      { text: "첫", startMs: 200, endMs: 300 },
      { text: " 셋째", startMs: 4000, endMs: 4100 },
    ]);
  });

  it("재연결 중 5.10이 실패하면(config throw) 다시 시도하지 않고 error", async () => {
    const { hook } = await listening();
    issueSttToken.mockResolvedValueOnce({ ok: false, code: "STT_UNAVAILABLE", status: 503 });

    act(() => lastSocket().drop());
    await flush(1000);

    expect(hook.result.current.status).toBe("error");
    expect(sockets()).toHaveLength(1);
    await flush(10_000);
    expect(issueSttToken).toHaveBeenCalledTimes(2);
  });

  it("재연결 중 stop()은 finished 없이 종료되고 5.10을 더 호출하지 않는다", async () => {
    const { hook } = await listening();
    act(() => lastSocket().drop());
    await flush();

    let stopped = false;
    act(() => {
      void hook.result.current.stop().then(() => {
        stopped = true;
      });
    });
    await flush(1000);

    expect(stopped).toBe(true);
    expect(hook.result.current.status).toBe("idle");
    expect(issueSttToken).toHaveBeenCalledTimes(1);
    expect(sockets()).toHaveLength(1);
  });

  it("error 상태의 stop()은 즉시 종료된다", async () => {
    const { hook } = await listening();
    act(() => lastSocket().message({ error_code: 429, error_message: "limit_exceeded" }));
    await flush();
    expect(hook.result.current.status).toBe("error");

    let stopped = false;
    await act(async () => {
      await hook.result.current.stop();
      stopped = true;
    });

    expect(stopped).toBe(true);
  });

  it("5.10 대기 중 reconnect()하면 뒤늦게 재개된 앞 녹음이 새 음성 인식 녹음기를 중지하지 않는다", async () => {
    let releaseFirst: (value: SttTokenActionResult) => void = () => {};
    issueSttToken.mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)));
    const { hook } = await started();

    act(() => hook.result.current.reconnect());
    await flush();
    const sttRecorder = FakeMediaRecorder.instances[2];
    // 앞 녹음의 5.10이 이제 완료되어 SDK가 source.stop()을 호출한다.
    releaseFirst(tokenOk());
    await flush();
    lastSocket().accept();
    await flush();

    expect(hook.result.current.status).toBe("listening");
    expect(sttRecorder.state).toBe("recording");
  });

  it("AuthError(401)면 훅이 record()를 다시 호출해 새 키로 연결한다", async () => {
    const { hook } = await listening();

    act(() => lastSocket().message({ error_code: 401, error_message: "Invalid API key" }));
    await flush();

    expect(issueSttToken).toHaveBeenCalledTimes(2);
    expect(sockets()).toHaveLength(2);
    expect(lastSocket().protocols).toEqual(["soniox-api-key", "key-2"]);
    expect(hook.result.current.status).toBe("connecting");
  });
});

describe("useAnswerStt + 실제 SDK 정리", () => {
  it("start 직후 같은 틱에 화면을 떠나면 5.10도 WebSocket도 음성 인식 녹음기도 생성하지 않는다", async () => {
    const capture = createAnswerCapture();
    const begun = await capture.start();
    if (!begun.ok) throw new Error("capture failed");
    const hook = renderHook(() => useAnswerStt({ sessionId: 7 }));

    act(() => {
      hook.result.current.start({ capture, fileStartedAt: 0, questionText: "질문" });
      hook.unmount();
    });
    await flush(30_000);

    expect(issueSttToken).not.toHaveBeenCalled();
    expect(sockets()).toHaveLength(0);
    // 파일 녹음기 하나뿐이다.
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it("5.10 키를 발급받는 중(starting)에 stop()하면 응답 없이 대기하지 않고 즉시 종료되어 idle이 된다", async () => {
    let release: (value: SttTokenActionResult) => void = () => {};
    issueSttToken.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const { hook } = await started();

    let stopped = false;
    await act(async () => {
      await hook.result.current.stop();
      stopped = true;
    });
    // 뒤늦게 도착한 키로 연결하지 않는다.
    release(tokenOk());
    await flush(30_000);

    expect(stopped).toBe(true);
    expect(hook.result.current.status).toBe("idle");
    expect(sockets()).toHaveLength(0);
  });

  it("연결 중에 cancel()하면 WebSocket을 닫고, abort로 발생한 error는 무시하고 idle을 유지한다", async () => {
    const { hook } = await started();

    act(() => hook.result.current.cancel());
    await flush(30_000);

    expect(hook.result.current.status).toBe("idle");
    expect(lastSocket().readyState).toBe(FakeWebSocket.CLOSED);
    expect(sockets()).toHaveLength(1);
  });

  it("듣는 중에 화면을 떠나면 WebSocket을 닫고 음성 인식 녹음기를 중지한다", async () => {
    const { hook } = await listening();
    const sttRecorder = FakeMediaRecorder.instances[1];

    hook.unmount();
    await flush();

    expect(lastSocket().readyState).toBe(FakeWebSocket.CLOSED);
    expect(sttRecorder.state).toBe("inactive");
    // 파일 녹음은 화면(답변 녹음 dispose)이 중지한다.
    expect(FakeMediaRecorder.instances[0].state).toBe("recording");
  });
});
